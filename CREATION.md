# Creation notes

**After the tide** is an AI-assisted first-person horror game developed through **three rounds of prompts**.

| Role | Model |
| --- | --- |
| Planning and direction | GPT-6 Astra |
| Coding, game design and scene design | Gemini 4 Carbon |

The central premise is a coastal tide-observation station during its final shift: the outside sea recedes while the station's interior water rises. The game turns recording and relocated sound playback into its core interaction, with procedural architecture, machinery, signage and sound.

The open-source release includes the playable browser build, editable source, bilingual interface, offline builder and regression checks. The current interface places interaction feedback in the lower centre of the screen and supports English and Simplified Chinese without resetting progress.

## Prompt provenance

The three-round prompting workflow is credited here as part of the project's creation history. The original prompts are not reproduced in this repository; no reconstructed text is presented as a verbatim prompt transcript.

## Verification scope

Passing the offline regression suites does not imply that every browser, GPU or native-input route has been validated. Refer to [KNOWN-LIMITS.md](KNOWN-LIMITS.md) for the validation boundary of the included build.
