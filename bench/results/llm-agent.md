# LLM agent run

Setup: a coding agent received only `npm run bench -- describe` and the `eval --split dev` command, with at most 12 evaluations,
no access to the source code, the other policies or the test seeds, and no scripted search loops. It used 11 evaluations
(= 33 day-evaluations of 20 seeds). The simulation-based search (`sim-search`) used 952 day-evaluations.

| # | What it changed | dev total (KRW/day) | meets service levels |
|---|---|---|---|
| 01 | Generous start: cooks sized from cook-minutes per hour, 2-4 servers, longest-wait + backfill, best-fit tables | 697.9만 | yes |
| 02 | About one cook less per hour on all days (cooks were only 38-51% busy) | 746.3만 | yes |
| 03 | Fewer servers in quiet hours and at 21:00; a few rainy-day cooks less | 781.7만 | yes |
| 04 | More trimming in shoulder hours | 796.0만 | yes |
| 05 | Weekday 12:00 cooks to 3; more weekend and rainy server cuts | 804.9만 | yes |
| 06 | One more cook off one hour per day (rainy day lost money) | 804.2만 | yes |
| 07 | weighted-wait, delivery weight 2 (favour delivery) | 803.0만 | **no** (weekend hall p90 wait 924 s) |
| 08 | weighted-wait, delivery weight 0.5 (favour the hall) with attempt-06 staffing | 805.2만 | yes |
| 09 | 11:00 cooks 3 to 2 on weekend and rainy days | 808.2만 | yes |
| 10 | Rainy 13:00 and weekday 19:00 servers to 2 | 810.8만 | yes |
| 11 | Weekend and rainy 19:00 servers to 2 (final) | 813.2만 | yes |

Test seeds: meets every service level, 812.4만 KRW/day (sim-search 818.4만, best rule-based plan 805.2만 but it misses a service level).

What the agent reasoned, in its own summary:
- Cooks sized from cook-minutes were only 38-51% busy, so most early gains came from cutting cooks.
- Hall losses stayed at 3.5-4.4% whatever it did with staff: with 17 tables and about 36 minutes per party the store seats
  roughly 28 parties an hour, fewer than arrive at peak. More staff cannot fix a table bottleneck, so it added none.
- A server hour (14,000 KRW) costs about one lost guest's margin (12,920 KRW), so late cuts were close to break-even.
- Favouring delivery broke the hall wait limit (the hall wait includes waiting for the kitchen); favouring the hall
  freed slack that it then spent on cheaper staffing.
- It stopped at 11 evaluations because further cuts would sit too close to the limits to hold on unseen seeds.

Note: it never tried the table rule (`limit-empty-seats`), which `sim-search` uses on two of the three days.
