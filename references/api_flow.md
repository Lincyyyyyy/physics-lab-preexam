# API flow

Base URL: `http://172.31.80.14:7101`

All authenticated endpoints use an ASP.NET session cookie. The login response also returns `Data.GUID`, which the front end sends as an `Authorization` header; the cookie alone is usually enough, but sending both is safer.

## Login

1. `GET /Student/ReadyForExam/ReadyForExam` to establish a session.
2. `GET /CheckCode.ashx?Flag=DengLu` to fetch the captcha image. The image belongs to the current session cookie.
3. `POST /Login/UserLogin` with form fields:
   - `userId`: Base64(username)
   - `userPass`: Base64(password)
   - `checkcode`: the 4-character captcha text

On failure, the code is invalidated; fetch a new captcha and session rather than retrying the same code.

## Exam entry and paper generation

1. `POST /Student/ReadyForExam/FindOrInsertStudentInfo` with `ExamInfo` JSON. Idempotent; call before entering an exam.
2. `POST /Student/ReadyForExam/JudgeEnterExam` with the same `ExamInfo` JSON after clearing `StartTime`, `EndTime`, and `PublishTime`.
   - `Data` is the attempt message such as `最大预习次数为3次，这是您第1次预习！`.
   - `ErrorInfo` is the actual paper name for this attempt.
   - `OtherDate` is the original paper XML.
3. `POST /Student/ReadyForExam/GetPaperContent` with:
   - `ContentXml`: `JudgeEnterExam.OtherDate`
   - `IP` and `Port`: split from the site URL
   - `ExamID` and `StudentID`
   - Response `Data` is rendered HTML; `OtherDate` is `NewContentXml`.

Choices are randomized per attempt. Use `NewContentXml` as the source of truth for question IDs and `StdAnswer`, not the original XML.

## Answer control naming

- Single choice (`Type="SS"`): radio `name='ss{QuestionID}'`, value is the option letter.
- Multiple choice (`Type="MS"`): checkbox `id='ms{QuestionID}_{letter}'`, value is that letter.
- True/false (`Type="TF"`): radio `name='tf{QuestionID}'`, value `T` for `正确`, `F` for `错误`.
- Fill blank (`Type="BL"`): multiple selects with ids `bl{QuestionID}_0`, `_1`, ...; `StdAnswer` is semicolon separated in the same order, e.g. `C;A;B`.
- Thinking (`Type="SK"`): textarea id contains `QuestionID`; use `StdAnswer` as text.
- Operation (`Type="OP"`): not supported by the provided script; requires the external lab application.

## Submit

`POST /Student/ReadyForExam/SubmitExam` with:

- `PaperContentXml`: the `NewContentXml` from `GetPaperContent`.
- `BGContent`: JSON array of `{Name, Value}` items built from the controls above.
- `OriginalTime`: current `yyyy-MM-dd HH:mm:ss`.
- `ExamInfo`: the exam info object, but update `PaperName` to `JudgeEnterExam.ErrorInfo` and format `StartTime`/`EndTime`/`PublishTime`.
- `LabResourceIDArr`: `"[]"` when there are no operation questions.

The response `IsSuccess=true` is the successful submission; the returned HTML contains the score under `id='GainShowScore'`.

## Troubleshooting

- `提交失败` with `RTNCode=-2`: usually an `ExamInfo.PaperName` mismatch. Use `JudgeEnterExam.ErrorInfo` as `PaperName`.
- `未将对象引用设置到对象的实例。`: `ExamInfo` is missing or malformed.
- `值对于 Int32 太大或太小。`: `OriginalTime` is missing or unparseable.
- `评阅试卷失败`: `BGContent` is missing or malformed.
- Captcha rejected: fetch a new session and captcha; do not brute force.
- Session returns the login page: the saved cookie is stale. Save cookies after every response, or re-run login.
