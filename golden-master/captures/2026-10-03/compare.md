# MaintVerify capture 2026-10-03 (staging) vs Vladimir baselines 2026-09-23

Run 37080951999, started 2026-10-03T00:13:48.636Z. Previous capture: 2026-10-02.

| Mode | HTTP | Time | vs baseline | vs previous capture |
|---|---|---|---|---|
| natal | 200 | 1719 ms | DIFFER at char 571 of 354904: baseline "..."],"designTime":["25 September 1979, 17:19:11","25 September 1979, 17:19:11","25 September 1979, 17:" vs staging "..."],"designTime":["25 September 1979, 17:23:51","25 September 1979, 17:23:51","25 September 1979, 17:" | unchanged |
| topo | 200 | 1541 ms | DIFFER at char 572 of 355328: baseline "...],"designTime":["25 September 1979, 17:22:17","25 September 1979, 17:22:17","25 September 1979, 17:2" vs staging "...],"designTime":["25 September 1979, 17:24:09","25 September 1979, 17:24:09","25 September 1979, 17:2" | unchanged |
| calendar | 200 | 1551 ms | DIFFER at char 830 of 1314656: baseline "...ini","zodiac_l":"Gemini","zodiac_acro":"","tarot":"The Lovers","zodiacId":2,"zodiacDegree":24,"zodia" vs staging "...ini","zodiac_l":"Gemini","zodiac_acro":"GE","tarot":"The Lovers","zodiacId":2,"zodiacDegree":24,"zod" | unchanged |
| calendar_moon | 200 | 577 ms | DIFFER at char 107 of 160727: baseline "..."June 2020","chart":{"settings":{"skin":0,"houseSystem":"W","isAscFixed":false,"houseSystemName":"Wh" vs staging "..."June 2020","chart":{"settings":{"skin":19,"houseSystem":"P","isAscFixed":false,"houseSystemName":"P" | unchanged |
| cycles | 200 | 1245 ms | MATCH | unchanged |
| panchanga | 200 | 1030 ms | MATCH | unchanged |
| chinese | 200 | 8504 ms | MATCH | unchanged |
