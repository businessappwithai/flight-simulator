# Experience Forest

The DecisionQueue remains short-term temporal working memory. Long-term learning is a branching ExperienceForest keyed by situation fingerprint.

Successful sequences reinforce continuation edges. Branches are classified GOOD, PROMISING, UNCERTAIN, BAD or CATASTROPHIC from repeated evidence. BAD/CATASTROPHIC branches are excluded from normal candidate generation but retained in negative memory so the pilot does not repeatedly rediscover failures.

A separate FastTreeIndex provides high-speed situation-to-action retrieval. It is an index only: authoritative experience, provenance, counterfactual evidence and continuation structure remain in Flight World data structures. This permits a native/WASM tree implementation to be substituted without coupling cognition to a third-party model format.
