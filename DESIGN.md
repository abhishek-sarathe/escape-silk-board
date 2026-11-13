# DESIGN.md

### 1. The moment: What did you design for?
I built everything around the auto haggling standoff at Silk Board. With ₹500, a dying battery, and an auto driver refusing the meter for a ₹1,190 fare, throwing a cold samosa into the deal creates the chaotic Bangalore humor and instant stakes that set the entire tone.

### 2. The cut: What did you leave out?
I cut a multi-branching metro transit minigame. In an hour, building a fragile multi-modal pathing simulation would dilute the tension. Focusing instead on a tight, deterministic state engine with AES-256 tokens and an animated live transit map kept the game fair, fast, and completely bug-free.

### 3. The miss: Where was the AI wrong?
The referee LLM classified "Run to the check-in counter" as a walking action. At the airport, the engine refused it with "already at airport", trapping the player in a loop until check-in closed. I caught it through eval testing and mapped airport counter actions directly to check-in.
