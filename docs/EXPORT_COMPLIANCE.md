# Export compliance and cryptography notice

This document describes the cryptographic functionality in Markspread
and where redistribution is governed by export control regulations.
It is provided for transparency; it is not legal advice.

## Cryptography in Markspread

Markspread does not implement cryptographic primitives. It uses
existing libraries and operating-system facilities for the following
purposes:

| Purpose                              | Mechanism                                  |
|--------------------------------------|--------------------------------------------|
| TLS for network requests             | OS-provided TLS stack (Schannel on Windows, Secure Transport / Network.framework on macOS, OpenSSL via reqwest/rustls on Linux) |
| Update artifact signatures           | Ed25519 signatures verified against the publisher key bundled in the binary |
| Plugin manifest signatures           | Ed25519 signatures verified against the marketplace publisher key |
| AI provider key storage              | OS keychain (Keychain Services on macOS, DPAPI-backed Credential Manager on Windows, libsecret on Linux) |
| Backup file integrity                | SHA-256 checksum over the canonical-serialised payload |
| Plugin sandbox identity              | Per-plugin random 128-bit token, stored in the OS keychain |

There is no end-to-end encryption product feature. Notes are stored
on disk in plaintext (the user's filesystem provides at-rest
protection if they choose to enable it).

## United States — Export Administration Regulations (EAR)

Markspread, as a publicly available open-source project that uses
publicly available cryptographic functionality, falls under
ECCN **5D002** with the **TSU** licence exception under
[15 CFR §740.13(e)](https://www.bis.doc.gov/index.php/documents/regulations-docs/2331-740-13/file).

A notification of the public availability of the source code has
been emailed to:

- `crypt@bis.doc.gov`
- `enc@nsa.gov`

with a link to the project repository at
<https://github.com/markspread/markspread>.

If you redistribute Markspread in a way that combines it with
additional cryptographic functionality, or you embed it in a closed
product, the TSU exception may not cover your case. Consult counsel.

## European Union — Dual-Use Regulation

The project may fall under the EU Dual-Use Regulation
[(EU) 2021/821](https://eur-lex.europa.eu/eli/reg/2021/821/oj). The
General Software Note exempts publicly available software from most
controls; the source is openly published on GitHub and the binary
artefacts are produced from that public source.

## United Kingdom

The UK retains a regime substantially similar to the EU regulation
post-Brexit (Statutory Instrument 2021/293). The same general
software note applies.

## Republic of Korea

Markspread's primary maintainers are based in the Republic of Korea.
The
[Strategic Item Export and Import Notice](https://www.law.go.kr/lsBylInfoPLinkR.do?lsiSeq=193960&bylNo=0001&bylBrNo=00&bylCls=BE&bylClsCd=BE)
under the Foreign Trade Act covers controlled cryptographic items.
We rely on the public-availability exemption: the source is openly
hosted, the binaries are reproducible from that source, and no
non-public cryptographic implementation is shipped.

## Sanctioned destinations

We do not operate any servers that block downloads by jurisdiction.
You should however not download or use Markspread if doing so would
breach the laws applicable to you. The
[OFAC sanctions list](https://ofac.treasury.gov/sanctions-list-service)
identifies the destinations the United States restricts; the EU and
Korean equivalents publish their own lists.

## What this document is not

- **Not legal advice.** If you redistribute Markspread commercially,
  embed it in a regulated product, or distribute to a jurisdiction
  with stricter rules, consult your own counsel.
- **Not a guarantee of security.** "Uses TLS" does not mean "your
  threat model is covered". The
  [Security policy](./../SECURITY.md) explains what we do and do
  not protect against.

## Updating this notice

When a release adds, removes, or changes a cryptographic component
in the table above, update this document in the same PR. The
release CI fails if the table references a crate that is no longer
in `Cargo.lock`.
