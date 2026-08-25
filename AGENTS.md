# qifu-dailywork development instructions

- `docs/workflow-v17/` is the checked-in business-rule baseline. When the installed `$prayer-daily-workflow` skill is newer, review and synchronize the newer rule set before changing production behavior.
- Never commit customer photos, PDFs, order content, credentials, cookies, browser profiles, local receipts, NAS runtime folders, or timing logs containing business data.
- Diagnose with a read-only plan first. Online uploads and status changes must remain idempotent and must be verified by file hashes and order-ID hashes.
- Every production defect requires a regression test before the implementation fix is merged.
- Run `npm test` and `ui/Run-Tests.ps1` before release.
