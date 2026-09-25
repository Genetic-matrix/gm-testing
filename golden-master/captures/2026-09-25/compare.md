# MaintVerify capture 2026-09-25 (staging) vs Vladimir baselines 2026-09-23

Run local, started 2026-09-25T14:13:34.426Z. Previous capture: 2026-09-23.

| Mode | HTTP | Time | vs baseline | vs previous capture |
|---|---|---|---|---|
| natal | 200 | 1740 ms | DIFFER at char 571 of 354904: baseline "..."],"designTime":["25 September 1979, 17:19:11","25 September 1979, 17:19:11","25 September 1979, 17:" vs staging "..."],"designTime":["25 September 1979, 17:23:51","25 September 1979, 17:23:51","25 September 1979, 17:" | unchanged |
| topo | 200 | 1239 ms | DIFFER at char 572 of 355328: baseline "...],"designTime":["25 September 1979, 17:22:17","25 September 1979, 17:22:17","25 September 1979, 17:2" vs staging "...],"designTime":["25 September 1979, 17:24:09","25 September 1979, 17:24:09","25 September 1979, 17:2" | CHANGED at char 572: before "...],"designTime":["25 September 1979, 17:26:58","25 September 1979, 17:26:58","25 September 1979, 17:2" now "...],"designTime":["25 September 1979, 17:24:09","25 September 1979, 17:24:09","25 September 1979, 17:2" |
| calendar | 200 | 1215 ms | DIFFER at char 830 of 1314656: baseline "...ini","zodiac_l":"Gemini","zodiac_acro":"","tarot":"The Lovers","zodiacId":2,"zodiacDegree":24,"zodia" vs staging "...ini","zodiac_l":"Gemini","zodiac_acro":"GE","tarot":"The Lovers","zodiacId":2,"zodiacDegree":24,"zod" | unchanged |
| calendar_moon | 200 | 628 ms | DIFFER at char 107 of 160727: baseline "..."June 2020","chart":{"settings":{"skin":0,"houseSystem":"W","isAscFixed":false,"houseSystemName":"Wh" vs staging "..."June 2020","chart":{"settings":{"skin":19,"houseSystem":"P","isAscFixed":false,"houseSystemName":"P" | CHANGED at char 3222: before "...nt":"Valleys - Narrow","environment_id":1,"environment_style":"Observed","environment_style_id":1,"i" now "...nt":"Valleys - Narrow","environment_id":9,"environment_style":"Observed","environment_style_id":1,"i" |
| cycles | 200 | 1165 ms | MATCH | unchanged |
| panchanga | 200 | 988 ms | MATCH | unchanged |
| chinese | 200 | 8435 ms | MATCH | unchanged |
