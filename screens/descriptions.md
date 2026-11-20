# Convexa showcase screens

All figures use the frozen demo book (net liquidation $64,624.16, day +$2,671.95) dated 20 November 2026. They are not a live account. App screens were captured full-bleed on the iPhone 16 Pro Max simulator (440×956 pt) with the status bar set to 9:41. Lock, Dynamic Island, and widget figures are composed renderings of the official demo views.

Optimized WebP copies used on the site live in `public/assets/`.

## 01-home-portfolio.png

Home shows demo net liquidation, the day change, filled margin tiles, and the QQQ smile for a ±3% move. The +3% row of the move table is complete above the tab bar. This is the whole book, with no horizon filter.

## 01-home-portfolio-bottom.png

The same Home screen scrolled so the move table is fully on screen: both the +3% and −3% rows are complete, with constant-vol and realized-vol columns.

## 02-analysis-smile-now.png

Analysis with the Today (Now) horizon: the smile is labelled “whole book” and keeps the 20 November 0DTE hedges in the curve.

## 03-analysis-smile-tomorrow.png

Analysis with the Tomorrow horizon: options expiring before the next session are dropped. The caption reads “without options 20.11,” and the smile changes shape.

## 04-analysis-virtual-leg.png

The Virtual leg card, marked “calculation only · nothing is sent.” Tomorrow 23.11, buy call 680, quantity 10. The strike ribbon shows whole chips (670–690). The preview reads “Draft on the chart: Buy 10 × 23.11 · call 680”.

## 04-analysis-virtual-leg-chart.png

Analysis, Tomorrow horizon (“without options 20.11”), with the same virtual call already on the smile. The gold and blue curves change shape versus the book-only chart.

## 05-analysis-legs-stepper.png

My positions, 20 November 0DTE hedges, each row a quantity stepper, Close, and undo. The 20.11 card sits fully above the tab bar.

## 05-analysis-legs-stepper-jan.png

The same positions list scrolled to the 15 January 2027 core. The January card is complete, including every leg and Reset all, above the tab bar.

## 06-vol.png

The Vol tab: “Vol now” (below usual, with VXN and VIX), ATM implied vol by expiry, and expected-move straddles for the week, the month, and January.

## 07-settings-live-activity.png

Live Activity settings, opened from Home so the Home tab stays selected. Live is off, Compact is selected, Health reports mode and source as demo and market as open. Feed URL and secret fields are not on this screen.

## 08-lock-compact-398.png

Lock Screen Live Activity in Compact layout, at the 398 pt content width on a 440 pt iPhone Pro Max canvas.

## 09-lock-two-lines-398.png

The same activity in Two lines: demo NLV and the day change, then QQQ, VIX, and VXN.

## 09-lock-two-lines-card-3x.png

A tighter 3× render of the Two lines card (398 pt wide) so the index line stays sharp when enlarged. Gold “12s” freshness, demo NLV, day change, and QQQ / VIX / VXN.

## 10-dynamic-island-compact.png

Compact Dynamic Island: $64.6K and +4.32%.

## 11-dynamic-island-expanded.png

Expanded Dynamic Island, matching the Two lines lock card.

## 12-widget-small.png / 12-widget-medium.png

Home Screen widgets on the demo book (not a $100k sample), rendered at 3×. Small has NLV, the day change, a gold “12s” freshness badge, the smile spark, and Worst ±2% at +$3,697. Medium adds QQQ and a Flat vol / Hedged chart with the same Worst figure.

## 13-lock-premarket-two-lines-398.png

Two lines lock card with a “Premarket · demo book” caption. A composed lock mock, not a full Home premarket screen.
