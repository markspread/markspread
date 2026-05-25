// S-AI-ACP-001 §2.1 / §3.4: NDJSON framing over arbitrary AsyncRead/AsyncWrite.
//
// NOTE on dead_code: `Transport` (unified read+write trait) and
// `MemoryTransport` are part of the public test seam. The production
// path uses `SplitTransport::split` and the split halves directly; the
// unified trait is for in-memory tests and a future single-task client
// implementation. Exposed at the module level rather than per-item so
// future contributors can add wire helpers without re-litigating each.
#![allow(dead_code)]

//
// The wire format is "one JSON value per line, terminated by \n". This file
// only deals with bytes — the JSON typing lives in `protocol.rs` and the
// request/response correlator in `client.rs`.
//
// Two impls of `Transport`:
//   * `StdioTransport` — wraps a `tokio::process::Child`'s stdin/stdout.
//   * `MemoryTransport` — wraps a pair of `tokio::io::duplex` pipes for
//     deterministic tests. Lets us simulate an agent without spawning a
//     process.
//
// Read-side has a hard 1 MiB line-length cap. A pathological agent that
// streams a giant unbounded line would otherwise OOM the editor; the cap
// returns a typed `TransportError::LineTooLong` instead.

use std::io;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use super::protocol::RawMessage;

/// Hard cap on a single NDJSON frame (UTF-8 bytes). Set generously high to
/// accommodate large `agent_message_chunk` blobs, but bounded so a runaway
/// agent cannot exhaust the heap.
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("transport io: {0}")]
    Io(#[from] io::Error),
    #[error("transport json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("transport eof")]
    Eof,
    #[error("transport line exceeded {limit} bytes")]
    LineTooLong { limit: usize },
}

#[async_trait::async_trait]
pub trait Transport: Send + Sync {
    async fn send(&mut self, msg: &RawMessage) -> Result<(), TransportError>;
    async fn recv(&mut self) -> Result<RawMessage, TransportError>;
}

/// Splittable transport so reader and writer halves can move into separate
/// tasks (the client uses this to run a long-lived reader loop while the
/// writer is driven by an mpsc).
#[async_trait::async_trait]
pub trait SplitTransport: Send {
    type Reader: TransportRead;
    type Writer: TransportWrite;
    fn split(self) -> (Self::Reader, Self::Writer);
}

#[async_trait::async_trait]
pub trait TransportRead: Send + 'static {
    async fn recv(&mut self) -> Result<RawMessage, TransportError>;
}

#[async_trait::async_trait]
pub trait TransportWrite: Send + 'static {
    async fn send(&mut self, msg: &RawMessage) -> Result<(), TransportError>;
}

pub struct NdjsonReader<R> {
    inner: BufReader<R>,
    buf: Vec<u8>,
}

impl<R: AsyncRead + Unpin + Send + 'static> NdjsonReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            inner: BufReader::new(reader),
            buf: Vec::with_capacity(4096),
        }
    }
}

#[async_trait::async_trait]
impl<R: AsyncRead + Unpin + Send + 'static> TransportRead for NdjsonReader<R> {
    async fn recv(&mut self) -> Result<RawMessage, TransportError> {
        loop {
            self.buf.clear();
            // read_until('\n') so we can enforce the size cap before
            // returning even a partial line.
            loop {
                let n = self.inner.read_until(b'\n', &mut self.buf).await?;
                if n == 0 {
                    return Err(TransportError::Eof);
                }
                if self.buf.len() > MAX_LINE_BYTES {
                    // Drain to next newline to keep the stream framed,
                    // discarding the oversized bytes, then report.
                    let mut sink = Vec::with_capacity(4096);
                    while !self.buf.ends_with(b"\n") {
                        sink.clear();
                        let drained = self.inner.read_until(b'\n', &mut sink).await?;
                        if drained == 0 {
                            break;
                        }
                        if sink.ends_with(b"\n") {
                            break;
                        }
                    }
                    return Err(TransportError::LineTooLong {
                        limit: MAX_LINE_BYTES,
                    });
                }
                if self.buf.ends_with(b"\n") {
                    break;
                }
            }
            // Strip trailing \r\n or \n. Empty lines are ignored.
            let mut end = self.buf.len();
            if end > 0 && self.buf[end - 1] == b'\n' {
                end -= 1;
            }
            if end > 0 && self.buf[end - 1] == b'\r' {
                end -= 1;
            }
            if end == 0 {
                continue;
            }
            let slice = &self.buf[..end];
            let msg: RawMessage = serde_json::from_slice(slice)?;
            return Ok(msg);
        }
    }
}

pub struct NdjsonWriter<W> {
    inner: W,
}

impl<W: AsyncWrite + Unpin + Send + 'static> NdjsonWriter<W> {
    pub fn new(writer: W) -> Self {
        Self { inner: writer }
    }
}

#[async_trait::async_trait]
impl<W: AsyncWrite + Unpin + Send + 'static> TransportWrite for NdjsonWriter<W> {
    async fn send(&mut self, msg: &RawMessage) -> Result<(), TransportError> {
        let mut bytes = serde_json::to_vec(msg)?;
        bytes.push(b'\n');
        self.inner.write_all(&bytes).await?;
        self.inner.flush().await?;
        Ok(())
    }
}

/// In-memory duplex transport for tests. Wires two `tokio::io::duplex`
/// pipes so the client and a fake agent can exchange NDJSON frames
/// without spawning a process.
pub struct MemoryTransport {
    reader: NdjsonReader<tokio::io::DuplexStream>,
    writer: NdjsonWriter<tokio::io::DuplexStream>,
}

impl MemoryTransport {
    /// Returns `(client_side, agent_side)` — anything `client_side.send`s
    /// arrives at `agent_side.recv`, and vice versa.
    pub fn pair(capacity: usize) -> (Self, Self) {
        let (c2a_w, c2a_r) = tokio::io::duplex(capacity);
        let (a2c_w, a2c_r) = tokio::io::duplex(capacity);
        let client = MemoryTransport {
            reader: NdjsonReader::new(a2c_r),
            writer: NdjsonWriter::new(c2a_w),
        };
        let agent = MemoryTransport {
            reader: NdjsonReader::new(c2a_r),
            writer: NdjsonWriter::new(a2c_w),
        };
        (client, agent)
    }
}

#[async_trait::async_trait]
impl Transport for MemoryTransport {
    async fn send(&mut self, msg: &RawMessage) -> Result<(), TransportError> {
        self.writer.send(msg).await
    }
    async fn recv(&mut self) -> Result<RawMessage, TransportError> {
        self.reader.recv().await
    }
}

impl SplitTransport for MemoryTransport {
    type Reader = NdjsonReader<tokio::io::DuplexStream>;
    type Writer = NdjsonWriter<tokio::io::DuplexStream>;
    fn split(self) -> (Self::Reader, Self::Writer) {
        (self.reader, self.writer)
    }
}

/// Wraps a spawned child process's stdin/stdout into the transport API.
/// stderr is consumed in a background task and surfaced via tracing.
pub struct StdioTransport {
    reader: NdjsonReader<tokio::process::ChildStdout>,
    writer: NdjsonWriter<tokio::process::ChildStdin>,
    _child: tokio::process::Child,
}

impl StdioTransport {
    /// Consumes a spawned `Child` (with stdin/stdout piped). Spawns a stderr
    /// drain task that forwards each line via `tracing::warn!`. The child
    /// is owned by the transport so dropping the transport reaps the child.
    pub fn from_child(mut child: tokio::process::Child) -> Result<Self, TransportError> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| TransportError::Io(io::Error::other("child stdin not piped")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| TransportError::Io(io::Error::other("child stdout not piped")))?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut buf = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match buf.read_line(&mut line).await {
                        Ok(0) => return,
                        Ok(_) => tracing::warn!(target: "acp::stderr", "{}", line.trim_end()),
                        Err(_) => return,
                    }
                }
            });
        }
        Ok(StdioTransport {
            reader: NdjsonReader::new(stdout),
            writer: NdjsonWriter::new(stdin),
            _child: child,
        })
    }
}

#[async_trait::async_trait]
impl Transport for StdioTransport {
    async fn send(&mut self, msg: &RawMessage) -> Result<(), TransportError> {
        self.writer.send(msg).await
    }
    async fn recv(&mut self) -> Result<RawMessage, TransportError> {
        self.reader.recv().await
    }
}

impl SplitTransport for StdioTransport {
    type Reader = NdjsonReader<tokio::process::ChildStdout>;
    type Writer = NdjsonWriter<tokio::process::ChildStdin>;
    fn split(self) -> (Self::Reader, Self::Writer) {
        (self.reader, self.writer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::protocol::{Notification, Request, RequestId, Response};
    use serde_json::json;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn memory_transport_round_trips_three_frames_with_escaped_newlines() {
        let (mut client, mut agent) = MemoryTransport::pair(64 * 1024);
        let msgs: Vec<RawMessage> = vec![
            RawMessage::Request(
                Request::new(RequestId::from_u64(1), "initialize", &json!({"a": 1})).unwrap(),
            ),
            RawMessage::Notification(
                // Embedded newlines inside a string must survive: JSON
                // encodes them as \n, so the wire frame remains one line.
                Notification::new("session/update", &json!({ "text": "line1\nline2\nline3" }))
                    .unwrap(),
            ),
            RawMessage::Response(Response {
                jsonrpc: "2.0".into(),
                id: RequestId::from_u64(1),
                result: Some(json!({"ok": true})),
                error: None,
            }),
        ];
        for m in &msgs {
            client.send(m).await.unwrap();
        }

        for expected in &msgs {
            let got = agent.recv().await.unwrap();
            assert_eq!(
                serde_json::to_value(expected).unwrap(),
                serde_json::to_value(&got).unwrap()
            );
        }
    }

    #[tokio::test]
    async fn oversized_line_returns_typed_error() {
        // Hand-craft an oversized line bypassing the NdjsonWriter cap.
        let (c2a_w, c2a_r) = tokio::io::duplex(MAX_LINE_BYTES * 2 + 16);
        let mut reader: NdjsonReader<tokio::io::DuplexStream> = NdjsonReader::new(c2a_r);
        // We hold the writer in a task so the reader can advance.
        let huge = "x".repeat(MAX_LINE_BYTES + 1);
        let payload = format!("\"{huge}\"\n");
        let mut raw_writer = c2a_w;
        tokio::spawn(async move {
            let _ = raw_writer.write_all(payload.as_bytes()).await;
            let _ = raw_writer.flush().await;
        });
        let err = reader.recv().await.unwrap_err();
        match err {
            TransportError::LineTooLong { limit } => assert_eq!(limit, MAX_LINE_BYTES),
            other => panic!("expected LineTooLong, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn empty_lines_are_skipped() {
        let (c2a_w, c2a_r) = tokio::io::duplex(4096);
        let mut reader: NdjsonReader<tokio::io::DuplexStream> = NdjsonReader::new(c2a_r);
        let mut raw_writer = c2a_w;
        tokio::spawn(async move {
            let _ = raw_writer
                .write_all(b"\n\n{\"jsonrpc\":\"2.0\",\"method\":\"x\",\"params\":{}}\n")
                .await;
            let _ = raw_writer.flush().await;
        });
        let m = reader.recv().await.unwrap();
        match m {
            RawMessage::Notification(n) => assert_eq!(n.method, "x"),
            other => panic!("expected notification, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn eof_returns_typed_error() {
        let (c2a_w, c2a_r) = tokio::io::duplex(64);
        drop(c2a_w);
        let mut reader: NdjsonReader<tokio::io::DuplexStream> = NdjsonReader::new(c2a_r);
        let err = reader.recv().await.unwrap_err();
        matches!(err, TransportError::Eof);
    }
}
