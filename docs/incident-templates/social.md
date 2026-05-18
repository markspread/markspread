# Short-form notice template (Mastodon / X / etc.)

For each platform, post once when the advisory goes live. Keep it
short, link to the advisory, and don't include exploit details.

---

## Mastodon (500 chars)

> Security advisory: Markspread `<X.Y.Z>` patches a `<SEV-N>` issue
> in `<component>`. Update via Settings → Updates, or
> https://markspread.dev/download. Full advisory:
> https://markspread.dev/security/advisories/<id>
>
> Thanks to `@<reporter>` for the responsible disclosure.

## X (280 chars)

> Markspread `<X.Y.Z>` is out — patches a `<SEV-N>` issue. Update from
> Settings → Updates. Full advisory:
> https://markspread.dev/security/advisories/<id>
>
> H/T `<reporter>`.

## In-app notice (`notices.json`)

```json
{
  "id": "MS-SEC-YYYY-NNN",
  "kind": "security-advisory",
  "severity": "high",
  "minVersion": "X.Y.Z",
  "title": "Update to <X.Y.Z>",
  "body": "A <SEV-N> issue in <component> was fixed. Update from Settings → Updates.",
  "advisoryUrl": "https://markspread.dev/security/advisories/<id>",
  "publishedAt": "<RFC3339>"
}
```
