# CLAUDE.md — OYASAI ORIGIN（仮）

「日本のお野菜を世界へ。」— 畑から、未来の人への手紙。
コードはすべて 2026-11-02 12:00 以降に作る。

## 正の仕様（private/ にある。公開しない）
- 画面：`private/specs/uiux_spec.md`（v4）
- サービス・データの形：`private/specs/service_spec.md`（v4）
- 範囲・優先度・削る順：`private/specs/ops_rulings_v4.md`（R19〜R31。ほかの文書より優先）
- 見た目の土台：`private/specs/design_spec.md`

## 公開しないもの（必ず守る）
- `private/` は `.gitignore` 済み。中身（イベントの詳細・審査や提出の情報・企画書・お金の数字・日程）を、README・コード・コメント・コミットメッセージ・`.claude/` の中に書き写さない。
- 仕様から実装に必要な事実（画面・データの形・表示の約束）だけを使う。
- コミットや push の前に `git status` を見て、`private/`・`.env`・動画が入っていないことを確かめる（`npm run verify` でも確かめる）。

## 画面（4つ）
①残す `/keep` ②封をする `/seal` ③えらぶ `/choose` ④手紙 `/letter`。①②は日本語のみ。③④と結びは JP/EN 切り替え。

## 必ず守ること
- 農家の言葉は一字も直さない。quote は原文に完全一致するものだけ。照合は `npm run verify`。
- 理由が語られていない判断は reason: null と next_question。推測で埋めない。
- archive_only の項目は、受け取る側のどの画面・データにも出さない。
- Claude に本文・方言・土地の歴史を書かせない。Claude がするのは、分類・段落番号の割り当て・英訳だけ。
- 「架空」「見本」「合成音声・架空の語り手」「Translated by Claude」「仮」の表示を消さない。
- 読み上げはブラウザ標準（speechSynthesis）だけ。外部の音声サービス・音声ファイル・声の複製は使わない。skip_speech の部分は読まない。
- 決済・申し込み・入力フォーム・外部リンクは作らない。押しても「見本」の表示で止まる。
- 使わない：Streamlit、チャット UI、ログイン、録音。

## Claude の機能の使い分け（README にも同じ表を置く）
| 機能 | 何に使うか | 置き場所 |
|---|---|---|
| Skills | 聞き手の作法：farm-archive（残す）、eat-and-listen（手紙） | `.claude/skills/` |
| Structured outputs | Claude の出力の形を JSON Schema で固定 | `schemas/` |
| フック | `git commit` の前に `npm run verify` を走らせ、失敗したら止める | `.claude/settings.json`、`.claude/hooks/` |
| サブエージェント | label-checker：表示（架空・見本・合成音声・Translated by Claude・仮）と英訳の点検。読むだけ | `.claude/agents/label-checker.md` |
| MCP | 使わない（外部につなぐ必要がない）。理由を README に書く | — |

`npm run verify` が確かめること：quote・reason_quote の一字一句一致／archive_only の流出0件／英語訳の漏れ0件／送信・決済のコードがないこと／`private/`・`.env` が git に追跡されていないこと。

## README に置く6節
①誰の・どんな課題か ②3分で試せる始め方（仮データ同梱）③機能の使い分け表 ④試行錯誤の経緯（v1〜v4、各1行）⑤この期間に作ったもの／事前に書いた仕様（非公開・文書のみ）の区別 ⑥これから誰が使い続けるか（数字は「仮」）。
README にイベントの詳細や審査の話は書かない。エラーは日本語で、次に何をすればよいかまで出す。

## 秘密情報
- API キーは `.env` の `ANTHROPIC_API_KEY` から読む。コードに書かない。中身を表示しない。
- `.env` が `.gitignore` に入っていることを確かめてからコミットする。

## モデル
- アプリの中の API 呼び出しは、すべて **claude-opus-5-5**（Structured outputs）。モデル ID は日付をつけずにこのまま書く。
- 考える深さ（output_config.effort）：farm-archive（聞き取りを分ける）は `high`、英訳と段落の割り当ては `medium`（Opus 5.5 の既定は medium なので、明示して書く）。
- thinking は止められない（`{type: "disabled"}` は使わない）。必要なら `{type: "adaptive"}` を書くか、省く。
- Structured outputs と Citations は同時に使えない。原文との照合はコード（`npm run verify`）で行う。
- 安全のための判定で断られたとき（stop_reason が refusal）に備え、`stop_reason` を必ず確かめ、server-side fallbacks（`fallbacks: "default"`）を入れる。
- 通信が落ちたら1回だけ再試行し、だめなら `data/replay/` の保存 JSON を使う。
