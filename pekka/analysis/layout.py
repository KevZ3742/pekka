"""
Where things are on a Clash Royale replay recording.

All numbers are pixels in a 1170x2532 reference frame (an iPhone screen
recording). analyze.py rescales every video to 1170 px wide before reading
it, and anchors the top strip to the top edge and the bottom strip to the
bottom edge, so other phone sizes line up as long as the UI scales with width.
"""

REF_W, REF_H = 1170, 2532

# --- the two strips we cut out of every frame --------------------------------
STRIP_H = 260
TOP_STRIP_Y = 165          # opponent: elixir bar + hand
BOT_STRIP_Y = 2195         # you: hand + elixir bar (measured from the top)

# --- hands --------------------------------------------------------------------
SLOT_X = [155, 310, 465, 620]
CARD_W, CARD_H = 145, 180
TOP_CARD_Y = 235
BOT_CARD_Y = 2202

# The part of a card we compare: the artwork, without the frame or elixir drop.
ART_X, ART_Y, ART_W, ART_H = 28, 22, 90, 90

# --- elixir bars ----------------------------------------------------------------
ELIXIR_X0 = 108            # left end of the bar
ELIXIR_SEG_W = 102.2       # width of one elixir point (10 points across)
TOP_ELIXIR_Y = 199         # vertical centre of each bar
BOT_ELIXIR_Y = 2423

# --- reference card art (RoyaleAPI cards-150) -------------------------------------
# Scale and offset that make the downloaded art line up with the in-game art.
REF_SCALE = 1.175
REF_OFF_X, REF_OFF_Y = 43, 37
REF_MARGIN = 6             # search +-6 px around the expected position
