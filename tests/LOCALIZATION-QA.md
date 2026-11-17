# Interface and localization QA

This record describes the checks performed for the bilingual interface and lower-centre feedback update. Build filenames are content-hashed and change when source files are rebuilt; no historical bundle hash is treated as proof of a later build.

## Offline checks

- `tests/localization.mjs` checks dynamic distance, time and detent counts; nested directional/replay captions; station signs and documents; reversible language switching; and language changes when browser storage is denied.
- The production-bundle event route checks language changes during a run and while reading a document. Position, phase, time, pause state and checkpoints remain unchanged. A current notice can switch from Chinese to English and back using its preserved source copy.
- The route stays in English from the bridge onward. It covers all 19 interaction targets, simultaneous danger and interaction feedback, English failure guidance, checkpoint recovery, paper collection, the ending and restart. All nine offline suites and the complete event route passed.

These checks use WebGL/DOM stubs. They validate the exercised logic and event flow, not hardware rendering or native input handling.

## Actual browser observations

- Desktop Chrome loaded the game over HTTP. `?lang=en` opened the English interface directly. Title and pause menus switched between English and Chinese, with translated setting labels, control instructions and visible entrance signs.
- Pressing R before collecting the recorder displayed the prerequisite feedback in both languages in the lower centre of the screen.
- At a 2137 × 1159 CSS-pixel viewport, the feedback container was 700 pixels wide and horizontally centred, with less than one pixel of rounding difference. The notice's lower edge was approximately 84% down the viewport.
- Prompts, notices, warnings and captions belong to `feedbackStack`. They use separate rows, and empty messages reserve no space. No browser warning or error logs were observed.

These observations do not establish a full native-input playthrough or GPU performance acceptance. See [validation scope and known limitations](../KNOWN-LIMITS.md).
