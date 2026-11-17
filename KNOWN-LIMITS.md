# Validation scope and known limitations

The bilingual interface update focused on feedback placement and live English / Simplified Chinese switching. The records below distinguish offline checks from actual browser observations; rebuilding the project does not broaden that validation scope.

## Verified scope

- `python3 scripts/run_offline_checks.py` completed with exit code 0: nine offline regression suites and a production-bundle event route covering all 19 interaction targets passed. The route covers valves, lures, power, the chart recorder, paper collection, failure recovery and restart. It uses English from the bridge through the ending. Language changes preserve position, game time, pause state and checkpoints; an open document remains open.
- English coverage checks passed for 248 static source strings and dynamic countdown, distance, detent and recorded-event counts. Original Chinese copy is retained for reversible switching.
- Actual desktop Chrome loaded the WebGL scene over HTTP at [the English entry point](http://127.0.0.1:8000/?lang=en). Browser checks covered title/settings/pause menus in both language directions, visible English entrance signs, Chinese and English blocked-action feedback, and the shared lower-centre feedback container. No browser warning or error logs were observed during those checks.

## Not established by these checks

- The browser checks cover the entrance interface and feedback layout. They do not establish a complete native keyboard-and-mouse playthrough of this release, or hardware performance measurements for every room. The offline WebGL/DOM stub tests are not a substitute for full browser acceptance.
- `frameStats` records `requestAnimationFrame` intervals, not GPU execution time. It cannot substantiate GPU median or P95 timing claims.
- The environment remains a stylized industrial space built from procedural geometry and textures. An informed simulated route takes approximately 2.5–3.2 minutes; first-time player completion time has not been measured.
- Historical screenshots from earlier builds are not used as evidence of the current release's appearance.
