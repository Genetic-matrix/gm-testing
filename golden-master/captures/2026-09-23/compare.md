# MaintVerify capture 2026-09-23 (staging) vs Vladimir baselines 2026-09-23

| Mode | HTTP | Time | Result |
|---|---|---|---|
| natal | 200 | 1764 ms | DIFFER at char 571 of 354904: baseline "..."],"designTime":["25 September 1979, 17:19:11","25 September 1979, 17:19:11","25 September 1979, 17:" vs staging "..."],"designTime":["25 September 1979, 17:23:51","25 September 1979, 17:23:51","25 September 1979, 17:" |
| topo | 200 | 1147 ms | DIFFER at char 572 of 355328: baseline "...],"designTime":["25 September 1979, 17:22:17","25 September 1979, 17:22:17","25 September 1979, 17:2" vs staging "...],"designTime":["25 September 1979, 17:26:58","25 September 1979, 17:26:58","25 September 1979, 17:2" |
| calendar | 200 | 1178 ms | DIFFER at char 830 of 1314656: baseline "...ini","zodiac_l":"Gemini","zodiac_acro":"","tarot":"The Lovers","zodiacId":2,"zodiacDegree":24,"zodia" vs staging "...ini","zodiac_l":"Gemini","zodiac_acro":"GE","tarot":"The Lovers","zodiacId":2,"zodiacDegree":24,"zod" |
| calendar_moon | 200 | 557 ms | DIFFER at char 107 of 160727: baseline "..."June 2020","chart":{"settings":{"skin":0,"houseSystem":"W","isAscFixed":false,"houseSystemName":"Wh" vs staging "..."June 2020","chart":{"settings":{"skin":19,"houseSystem":"P","isAscFixed":false,"houseSystemName":"P" |
| cycles | 200 | 1195 ms | MATCH |
| panchanga | 200 | 995 ms | MATCH |
| chinese | 200 | 8598 ms | MATCH |
