# Dashboard layout

The Three.js world and primary operational telemetry occupy the main column. "Why this decision?" is a persistent right-side card on desktop and naturally moves below the main area on narrow screens.

By default the side card follows the newest live decision. Clicking a historical decision pins it for investigation; "Resume live" returns to the latest decision. Pausing the UI never pauses the simulator.

The lower diagnostics area uses Timeline, Learning, Safety and Raw Telemetry tabs so detailed diagnostics do not compete with the flight view. The side card remains visible while switching diagnostic tabs.
