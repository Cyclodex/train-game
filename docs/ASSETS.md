# Third-party assets

Every file in this repository that was not authored here, with its provenance.

**Why this file exists:** reconstructing after the fact which sound came from
where, under which licence, is the classic asset-licensing trap — and if the
project's own licence ever changes, or it ships commercially, this list is the
only thing that answers the question. Add a row in the same commit that adds a
file; never add an asset without one.

**The standing rule for this project: CC0 only.** CC0 (public domain) carries no
attribution requirement and no share-alike clause, so it stays usable if the
game is ever released commercially, with nothing to track at ship time. CC-BY is
acceptable in principle but obliges us to carry credits; **CC-BY-SA and any
non-commercial (NC) licence are not used here** — share-alike propagates
obligations into the project, and NC forecloses the commercial option outright.
(A CC-BY-SA railway recording on OpenGameArt was rejected on exactly this
ground while these sounds were chosen.)

The attributions below are therefore **voluntary** — CC0 requires none. Kenney
asks for optional credit, and it costs nothing to give it.

## Audio — `src/audio/samples/`

All five files: **Kenney** (<https://kenney.nl>), **CC0 1.0 Universal (public
domain)**, downloaded **2026-08-22**. Kenney's own licence text: *"This content
is free to use in personal, educational and commercial projects."*

| File in repo | Source pack | Original filename | Used for |
|---|---|---|---|
| `delivery.ogg` | Interface Sounds 1.0 | `confirmation_001.ogg` | A train parks on a colour match |
| `bounce.ogg` | Impact Sounds | `impactWood_heavy_002.ogg` | A train thuds off the wrong depot |
| `cash.ogg` | Casino Audio | `chips-stack-1.ogg` | A fare is banked (Tycoon) |
| `switch.ogg` | Impact Sounds | `impactMetal_light_000.ogg` | The player throws a junction switch |
| `signal.ogg` | Interface Sounds 1.0 | `tick_001.ogg` | The player cycles a signal |

Files are renamed to their ROLE in the game, which is why the original names are
recorded here — that mapping is the chain of custody. `src/audio/samples.ts`
carries the per-cue gain and the reason each sound was picked.

### How these five were chosen

Not by filename. Each candidate was decoded through the same Web Audio path the
game uses and compared on duration, attack time, band energies, zero-crossing
rate and pitch movement; the winner's measurements are quoted in
`src/audio/samples.ts`. The one that most repays knowing: `delivery.ogg` rises
196Hz → 393Hz, a clean octave — a rising interval is what reads as *success*,
while the flat and falling candidates read as a mere acknowledgement, or as an
error.

## Music — `src/audio/music/`

All four: **OpenGameArt**, each page's licence field reads **CC0** (checked on
the page itself, not inferred from a search filter — a fifth candidate, *Gone
Fishin'*, showed CC-BY 4.0 / OGA-BY 3.0 there and was dropped). Downloaded
**2026-08-22**. Credits are voluntary under CC0 and given anyway.

| File in repo | Title | Author (OGA user) | Page | Original filename |
|---|---|---|---|---|
| `lasso-lady.ogg` | Lasso Lady (seamless loop) | congusbongus | <https://opengameart.org/content/lasso-lady-seamless-loop> | `lassolady_4.ogg` |
| `backfoot.ogg` | Backfoot (extended) | centurionofwar | <https://opengameart.org/content/backfoot> | `backfootextended_0.ogg` |
| `old-west-style.ogg` | Old West Style | Tozan | <https://opengameart.org/content/old-west-style> | `west1_0.ogg` |
| `bluebonnet.ogg` | Bluebonnet in B major (looped) | kistol | <https://opengameart.org/content/bluebonnet> | `bluebonnet_in_b_major_looped_0.ogg` |

Chosen for the bluegrass/western lilt Railroad Tycoon made the genre's
signature (three of them) plus one soft track so a long session has somewhere
to breathe; each file's measured level is in `src/audio/music.ts`, where a
per-track gain brings the playlist to one loudness (as published they differ by
~11dB). ~6MB in total, fetched lazily after the first gesture, never in the
main bundle.

### What is NOT a sample

The rolling ambience — the bed under moving trains and the rail-joint
clackety-clack — is **synthesised** (`src/audio/synth.ts`), not recorded, and
that is a design choice rather than a gap. A recorded loop plays at the tempo it
was recorded at, so it drifts against the trains on screen and the 1x/2x/4x
speed dial makes the mismatch obvious; driving it from the simulation's own
`trainVelocity` locks sound to picture at every speed. It also keeps the
ambience free of any licence at all.
