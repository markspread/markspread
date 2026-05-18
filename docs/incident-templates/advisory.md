# Security advisory template

Copy this verbatim into a GitHub Security Advisory (or
`markspread.dev/security/advisories`) when publishing.

---

## Summary

<one-paragraph description of the issue, in user-friendly language. No
exploit details. Mention the worst-case impact.>

## Severity

<SEV-1 / SEV-2 / SEV-3 / SEV-4>. CVSS 3.1: <score> (<vector>).

## Affected versions

| Component             | Versions affected | Patched version |
|-----------------------|-------------------|-----------------|
| `markspread` editor   | `< X.Y.Z`         | `X.Y.Z`         |
| `@markspread/sdk`     | `< A.B.C`         | `A.B.C`         |
| Marketplace catalogue | `<date>` and earlier | `<patched-date>` |

## What you should do

- **If you run version `< X.Y.Z`**: update via Settings → Updates,
  or download from <https://markspread.dev/download>.
- **If you can't update right now**: <workaround, if any. Otherwise:
  "There is no workaround. Please update at the earliest opportunity.">
- **Operators of self-hosted marketplaces**: <action, if any>.

## Timeline (UTC)

| When                          | What                                  |
|-------------------------------|---------------------------------------|
| YYYY-MM-DD HH:MM             | Report received from <reporter>       |
| YYYY-MM-DD HH:MM             | Triage complete; severity assigned    |
| YYYY-MM-DD HH:MM             | Patched build available internally    |
| YYYY-MM-DD HH:MM             | Public release                        |
| YYYY-MM-DD HH:MM             | Advisory published                    |

## Credit

Thanks to <reporter handle / name> for finding and responsibly
disclosing this issue.

## Tracking

- Internal: `MS-SEC-YYYY-NNN`
- CVE: <CVE-id, when assigned via GitHub>

## Contact

`security@markspread.app` (PGP fingerprint
`5F3A 1A6E 9B0D 4A77 2C0E  6D11 8B22 4F9C E1D5 7A40`).
