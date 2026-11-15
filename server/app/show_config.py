"""Where the show jumps in the video (seconds). The one place for these values: the server
sends them to the TVs in every "schedule" message, so the web app never keeps its own copy.
"""

SKIP_FROM = 166  # 1 minute into song 1 (the lights start at 106.0)
SKIP_TO = 5100  # start of the finale (TODO: set exact)
# The video time the show starts at. Must match SEGMENTS[0].start in web/src/config.ts
# (the TV's debug overlay warns if they differ).
SHOW_START_VIDEO_S = 0
