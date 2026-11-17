# Contributing to After the tide

Bug reports and focused improvements are welcome. Include your browser, operating system, graphics setting, the action you attempted and what happened. Avoid including personal information or browser storage contents.

For a code change:

1. Make the change in `src/` and keep English and Chinese player-facing text in sync through `src/i18n.js`.
2. Rebuild with `python3 scripts/build_dist.py` or the documented Vite workflow. Do not edit a generated bundle directly.
3. Run the relevant checks. On macOS, `python3 scripts/run_offline_checks.py` runs the offline suites and bundle route.
4. Check the affected interaction in a real browser. Describe the verification you actually performed, including any untested boundary.

Keep changes focused and preserve third-party license notices. See [README.md](README.md) for setup and controls.
