---
name: physics-lab-preexam
description: Complete and submit 大学物理实验预习题 on the 科大奥锐 pre-study system (172.31.80.14:7101) by reading the standard answers embedded in each generated paper. Use when the user asks to log in, answer, or submit one or more lab pre-study exams on this site. Do not use for unrelated exam systems, live Excel/Word tasks, or operation questions that require external lab software.
---

# Physics Lab Preexam

Automate this specific pre-study system end-to-end without opening a browser. The paper XML returned by the site contains the randomized choices and the correct `StdAnswer` for the current attempt, so answers can be submitted accurately without guessing.

## Safety limits

- Each exam allows at most 3 pre-study attempts. Normally submit exactly once.
- Never resubmit an exam that already has a successful score unless the user explicitly asks to correct it and remaining attempts exist.
- Only act on the exam IDs the user asks for. Do not sweep unrelated exams or alter other users' data.
- Do not brute-force the captcha or log in repeatedly. If automatic captcha reading fails, ask the user to read the generated image.

## Workflow

1. Read [references/api_flow.md](references/api_flow.md) before the first run.
2. Use `scripts/login.ps1` to create a session and, when captcha is provided, log in and save `session_cookies.json`.
3. Use `scripts/submit_exam.ps1 -ExamID <id> -Submit` for each requested exam, one at a time.
4. Confirm the response `IsSuccess` and `Score`. If an exam returns `IsSuccess=False`, read the troubleshooting section in the reference before retrying.

The scripts intentionally keep credentials out of the code. Pass `-Username` and `-Password` to `login.ps1` when needed; do not commit or embed the password.

## Non-obvious invariants

- Parse the `NewContentXml` returned by `GetPaperContent`, not the original `JudgeEnterExam` paper XML, because choices are randomized.
- Update `ExamInfo.PaperName` to `JudgeEnterExam.ErrorInfo` before submitting; some exams have mismatched names and fail with generic `提交失败` otherwise.
- Call `FindOrInsertStudentInfo` before `JudgeEnterExam` for each exam.
- Save the session cookie after responses; the server can rotate it across requests.
