#!/usr/bin/env bash
#
# Add one image to the marketing email library.
#
#   scripts/add-email-image.sh <source-image> <name>
#   scripts/add-email-image.sh ~/Documents/claude/marketing-drop/nebraska.png ne-terrain-hero
#
# Produces, in public/email/:
#   <name>.jpg      1122px wide, height whatever the source's shape gives
#   <name>@1x.jpg    561px wide, same shape
#
# ⚠️ NEVER CROP, NEVER STRETCH. Owner instruction 2026-08-24: "Just use the
# images I sent, make them fit the width of the email, and then they will be
# however tall they will be based on their aspect ratio."
#
# This script previously forced every hero to 1122x748 (3:2) so the set would
# look uniform. That silently cut content off every one of them — Illinois was
# supplied 1122x1402 (portrait; Illinois IS a tall state) and got chopped to
# landscape, Missouri came in at 1.12:1 and Iowa at 1.55:1. States are not the
# same shape as each other and the renders should not pretend otherwise.
#
# Width-only resize with `sips -Z`, which scales the LONGEST side to fit a box
# and preserves aspect. Height is never specified anywhere: the template's
# <img> already carries height:auto with a max-width, so the browser derives
# it. Nothing in the chain sets a height, so nothing can distort.
#
# 1122 = 2x the 561px the email renders at, which is what keeps it sharp on a
# phone. That is a WIDTH, not a canvas.
#
# ⚠️ URLs are https://www.groundgoat.com/email/<name>.jpg — **www is REQUIRED,
# the apex 404s.**
set -euo pipefail

SRC="${1:?usage: add-email-image.sh <source-image> <name>}"
NAME="${2:?usage: add-email-image.sh <source-image> <name>}"
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")/.." && pwd)/public/email"
mkdir -p "$DIR"

SW="$(sips -g pixelWidth  "$SRC" | tail -1 | awk '{print $2}')"
SH="$(sips -g pixelHeight "$SRC" | tail -1 | awk '{print $2}')"
echo "source: ${SW}x${SH}"

for TARGET in 1122:"" 561:"@1x"; do
  W="${TARGET%%:*}"; SUFFIX="${TARGET##*:}"
  OUT="$DIR/${NAME}${SUFFIX}.jpg"
  # Height derived from the source's own ratio — passed to -Z only so the
  # long side cannot be the limiting one for a portrait image.
  H="$(python3 -c "import math;print(max(1,math.ceil($SH*$W/$SW)))")"
  sips -s format jpeg -s formatOptions 82 "$SRC" --out "$OUT" >/dev/null
  sips -Z "$(( W > H ? W : H ))" "$OUT" >/dev/null
  # -Z fits the LONGEST side; for a portrait source that leaves width short,
  # so resample width explicitly and let sips derive the height itself.
  sips --resampleWidth "$W" "$OUT" >/dev/null
  OW="$(sips -g pixelWidth "$OUT" | tail -1 | awk '{print $2}')"
  OH="$(sips -g pixelHeight "$OUT" | tail -1 | awk '{print $2}')"
  RATIO_IN="$(python3 -c "print(round($SW/$SH,4))")"
  RATIO_OUT="$(python3 -c "print(round($OW/$OH,4))")"
  if [ "$RATIO_IN" != "$RATIO_OUT" ]; then
    # Allow a sub-pixel rounding difference, reject anything real.
    python3 -c "import sys;sys.exit(0 if abs($RATIO_IN-$RATIO_OUT)<0.01 else 1)" \
      || { echo "ASPECT CHANGED ${RATIO_IN} -> ${RATIO_OUT} — refusing" >&2; exit 1; }
  fi
  printf '  %-28s %sx%s  ratio %s  %s KB\n' \
    "$(basename "$OUT")" "$OW" "$OH" "$RATIO_OUT" "$(( $(stat -f%z "$OUT") / 1024 ))"
done

cat <<MSG

Aspect ratio preserved. To publish:
    git add public/email/${NAME}*.jpg && git commit -m "Email hero: ${NAME}" && git push
Live at:
    https://www.groundgoat.com/email/${NAME}.jpg
MSG
