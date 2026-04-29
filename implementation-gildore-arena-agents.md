 Phase 1 
    - screenshot after tool activation → verify shortcut works
    - if not: click toolbar button directly as fallback
    - screenshot after each anchor placement
    - screenshot after escape (draw complete)
                                                                                                                                                      
  Phase 2
    - fix time-to-X calibration: read actual visible candle count from DOM
      instead of hardcoded 130
    - fix price-to-Y: verify the DOM selector matches Deriv's actual chart
                                                                                                                                                      
  Phase 3
    - post-draw verification: compare before/after screenshots
    - if no new drawing detected, retry once with toolbar path
                                                                                                                                                      
  Phase 4 (only if still needed after Phase 1-3)
    - bounded adaptive controller
    - pan/zoom prep loop
    - AI-assisted readiness check
                                                                                                                                                      
  The plan's medium-term direction is right. But I'd estimate Phases 1-2 alone fix the drawing — the agent layer may never be needed if tool
  activation and coordinate calibration are solid.


for the full agentic scanner mode

I think putting openclaw somewhere in the loop would have been the best approach yeah?
the openclaw uses a headless browser but can actually see the chart then make actions based on the strategy, 
it can pan, move, etc, etc draw the trendline, etc yeah?
