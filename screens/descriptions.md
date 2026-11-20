# Convexa showcase screens

All figures use the frozen demo book (net liquidation $64,624.16, day +$2,671.95) dated 20 November 2026. They are not a live account. App screens were captured full-bleed on the iPhone 16 Pro Max simulator (440×956 pt) with the status bar set to 9:41. Lock, Dynamic Island, and widget figures are composed renderings of the official demo views.

Optimized WebP copies used on the site live in `public/assets/`.

## 01-home-portfolio.png

Home shows demo net liquidation, the day change, and the QQQ smile for a ±3% move, with constant-vol and realized-vol outcomes under the chart. This is the whole book, with no horizon filter.

## 02-analysis-smile-now.png

Analysis with the Today (Now) horizon: the smile is labelled “whole book” and keeps the 20 November 0DTE hedges in the curve.

## 03-analysis-smile-tomorrow.png

Analysis with the Tomorrow horizon: options expiring before the next session are dropped. The caption reads “without options 20.11,” and the smile changes shape.

## 04-analysis-virtual-leg.png

The Virtual leg card, marked “calculation only · nothing is sent.” Today / Tomorrow / Any date, call or put, buy or sell, strike ribbon and quantity — still at quantity 0, so the leg is not on the chart.

## 05-analysis-legs-stepper.png

My positions, with the 20 November 0DTE hedges above the January 2027 core, each row a quantity stepper, Close, and undo.

## 06-vol.png

The Vol tab: “Vol now” (below usual, with VXN and VIX), ATM implied vol by expiry, and expected-move straddles for the week, the month, and January.

## 07-settings-live-activity.png

Live Activity settings: Live is off, Compact is selected, Health reports mode and source as demo. Feed URL and secret fields are not on this screen.

## 08-lock-compact-398.png

Lock Screen Live Activity in Compact layout, at the 398 pt content width on a 440 pt iPhone Pro Max canvas.

## 09-lock-two-lines-398.png

The same activity in Two lines: demo NLV and the day change, then QQQ, VIX, and VXN.

## 10-dynamic-island-compact.png

Compact Dynamic Island: $64.6K and +4.32%.

## 11-dynamic-island-expanded.png

Expanded Dynamic Island, matching the Two lines lock card.

## 12-widget-small.png / 12-widget-medium.png

Home Screen widgets on the demo book (not a $100k sample). Small has NLV, the day change, and Worst ±2%. Medium adds QQQ and a Flat vol / Hedged sketch.

## 13-lock-premarket-two-lines-398.png

Two lines lock card with a “Premarket · demo book” caption. A composed lock mock, not a full Home premarket screen.
