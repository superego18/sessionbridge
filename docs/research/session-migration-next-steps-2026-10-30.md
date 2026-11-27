# Claude ↔ Codex 세션 이관: 다음 개선 조사

**추천: 왕복할 때는 원래 도구의 세션을 재개하고, 반대편에서 생긴 변경분만 전달한다. 최초 이관은 공식 조회 API로 유효 대화 계보를 읽고, 원문·첨부·작업 상태를 별도로 보관한다.** 전체 파일을 매번 다른 형식으로 바꾸는 것만으로 실행 상태까지 보존할 수는 없다.

- 조사일: 2026-10-30 KST. 이번 작업은 조사·합성 입력 실험·문서 작성만 수행했다. 제품 코드, 설치, 실제 사용자 세션, 전역 설정은 변경하지 않았다. 외부 모델 요청도 하지 않았다.
- 자체 구현 기준: fork 1.4.3, [`a81b3f2`](https://github.com/superego18/sessionbridge/tree/a81b3f2f80f25d537487a4b1769fd5be6f096714). Codex 공개 소스 기준: `rust-v0.163.0` 태그를 해석한 실제 commit [`83086188`](https://github.com/openai/codex/tree/83086188ae0614bd882818ff1aa23f3194962012). 원격 main의 기능을 설치 버전에서 검증된 기능으로 바꾸어 말하지 않는다.
- Claude 상세 API·SDK 버전·한계는 [별도 조사](session-migration-claude-research-2026-10-30.md)에 있다. 아래 권고는 구현 완료나 완전 복원 보장이 아니다.

| 우선순위 | 개선 | 완료 판정 기준 |
| --- | --- | --- |
| 1 | 유효 대화 계보·압축·되돌림 처리 | 버린 가지/되돌린 턴 배제, 현재 압축 문맥 보존 |
| 2 | 원래 세션으로 복귀 + 변경분 인계 | Claude→Codex→원래 Claude에서 새 결정 누락·중복 주입 없음 |
| 3 | 공식 조회 API·페이지 전체 수집 | 여러 페이지·압축 파일·하위 세션까지 수집 범위 명시 |
| 4 | 첨부·작업 파일·지침·미완료 작업 묶음 | 참조 자산 해시 일치, 현재 파일과 과거 작업을 혼동하지 않음 |
| 5 | 재개 직후 요청까지 내용 검증 | UI 표시뿐 아니라 모델 요청의 필수 사실·이미지·도구 결과 확인 |

<details>
<summary>1. 직접 확인한 누락: 기존 22개 테스트를 통과해도 보존되지 않는 입력이 있다</summary>

- **자체 코드 사실:** Claude reader는 `parentUuid`를 주석에 언급하지만 실제로는 파일 순서로 모든 user/assistant를 누적한다. Codex reader는 `compacted`와 `thread_rolled_back`을 처리하지 않으며, 사용자 입력에서 텍스트만 모은다. [`claude-reader.ts`](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/claude-reader.ts), [`codex-parser.ts`](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/codex-parser.ts).
- **이번 합성 실험:** 임시 디렉터리에 만든 JSONL만 기존 파서로 읽었다. 실제 사용자 대화나 프로필은 사용하지 않았다. 아래 결과는 변환기 동작의 재현이며 실제 CLI가 그 합성 세션을 재개했다는 증거는 아니다.

| 합성 입력 | 실제 파서 결과 | 문제 |
| --- | --- | --- |
| `keep`, `discard` 두 턴 뒤 `thread_rolled_back: num_turns=1` | 두 질문 모두 남음 | 철회한 작업이 다시 문맥에 들어감 |
| `compacted.payload.replacement_history` 안에만 있는 요약 표식 | 표식 없음 | 압축으로 보존한 결정이 누락됨 |
| `input_image`만 있는 Codex 사용자 메시지 | 0턴 | 질문 자체가 없어짐 |
| `parentUuid`로 새 가지를 선택한 Claude 기록 | 버린 가지의 응답도 남음 | 상충하는 답변이 한 대화처럼 합쳐짐 |

- **공급자 근거:** Codex 자체 재구성기는 압축 대체 이력과 rollback을 따로 적용한다. 자체 파서의 단순 누적은 이 의미를 대신하지 못한다. [`rollout_reconstruction.rs`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/session/rollout_reconstruction.rs#L208), [rollback 적용](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/session/rollout_reconstruction.rs#L547).
- **제안:** 보관용 전체 이력과 재개용 현재 유효 문맥을 분리한다. 버린 가지와 압축 이전 원문은 삭제하지 않고 보관하되 현재 지시로 합치지 않는다. `gitBranch` 문자열 보존은 이 대화 계보 보존과 다른 항목이다.

</details>

<details>
<summary>2. 사용자 작업 방식에 맞는 대안: 원래 세션을 살리고 왕복 변경분만 전달</summary>

- **공식 기능:** Claude는 세션 ID로 resume하고 원본을 남긴 fork를 만들 수 있다. Codex도 저장된 thread ID의 resume/fork를 제공한다. 이 기능은 각 도구 안에서의 재개이며 Claude 세션을 Codex가 그대로 읽는 교차 실행 기능은 아니다. [Claude 세션 문서](https://code.claude.com/docs/en/agent-sdk/sessions), [Codex thread API 형식](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/src/protocol/v2/thread.rs).
- **제안 흐름:** Claude A를 보존 → Codex B에 현재 유효 문맥과 참고 원본 전달 → B에서 작업 → Claude A 또는 A의 fork를 재개 → B에서 추가된 요구·결정·검증 결과·미완료 작업을 전달한다. 최초 진입은 교차 이관이 필요하지만 복귀 때 A의 기존 이력을 다시 합성할 필요는 줄어든다.
- **파일 처리:** 같은 작업 폴더라면 이미 수정된 파일을 다시 patch로 적용하지 않는다. 출발/복귀 때 HEAD·작업 트리 상태·관련 파일 해시를 비교한다. 다른 worktree나 컴퓨터라면 코드 동기화와 대화 동기화를 별도로 검증해야 한다.
- **중복 방지:** A/B native ID와 선택한 대화 끝점, 마지막 인계 이벤트·내용 해시를 대응시킨다. 재인계는 그 이후 변경만 포함하며, 이전에 전달된 내용이 반대편을 거쳐 되돌아오는 순환 중복을 식별해야 한다. 단순 시간 비교만으로 계보·중복을 판정하지 않는다.
- **제약:** 원래 A에 남은 상태가 많아 유리하다는 설계적 추론이다. 다른 도구에서 실행된 터미널·권한·숨은 추론을 A가 이어받는다는 뜻이 아니다. 복귀 시점에 A가 압축하거나 정책·도구가 바뀌는 경우도 검증해야 한다. 이 왕복 방식은 이번에 실행하지 않았다.

</details>

<details>
<summary>3. 읽기부터 공식 API로 전환하되, 임의 이력 주입 기능은 안정성과 표시 범위를 따로 검증</summary>

- **자체 코드 사실:** 발견기는 `state_5.sqlite`와 `.jsonl` 파일을 직접 찾고, 파서는 UTF-8 줄 단위로 읽는다. 현재 native probe는 자체가 생성한 rollout을 migrate한 뒤 `thread/read(includeTurns=true)`로 검증한다. 이는 새 저장 방식에서 원래 만들어진 긴 세션의 추출까지 검증한 것은 아니다. [`session-discovery.ts`](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/session-discovery.ts), [`native-probe.mjs`](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/test/native-probe.mjs).
- **Codex 공식 조회:** `thread/list`로 찾고 `thread/turns/list`에서 `itemsView: full`, 또는 `thread/items/list`를 사용해 `nextCursor`가 끝날 때까지 수집하는 경로가 있다. 저장 방식에 따라 미지원 응답을 받을 수 있으므로 버전·형식을 확인한 fallback이 필요하다. 전체 응답을 한 번에 읽는 방식과 페이지 기본 summary를 전체 원문으로 취급하지 않는다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server), [설치 버전의 페이지 API 정의](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1742).
- **압축 저장:** Codex 원본 reader는 `.jsonl`과 `.jsonl.zst`를 모두 처리하고 표현 전환 중 재시도한다. 자체 파일 탐색·UTF-8 파서는 같은 처리를 하지 않는다. 원본 byte archive와 해제한 해석용 데이터를 구분해야 한다. [`compression.rs`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/rollout/src/compression.rs#L69).
- **Claude 공식 조회:** SDK의 `getSessionMessages`로 유효 linked chain을 얻고, raw archive는 별도로 유지하는 방향이 유력하다. 압축 이전 전체 원문과 유효 문맥은 같지 않다. 하위 세션은 별도 API로 읽는다. [Claude 담당 조사와 직접 출처](session-migration-claude-research-2026-10-30.md).
- **쓰기 후보:** Codex `thread/inject_items`는 모델 이력에 raw item을 추가하는 API다. 공식 소스의 모의 서버 테스트는 legacy/paginated 양쪽에서 저장과 실제 요청 포함을 검사한다. 따라서 JSONL·SQLite 직접 쓰기를 줄일 후보지만, 우리 설치 조합의 재시작·UI 표시·도구 schema·출처 역할 보존은 아직 시험하지 않았다. 반면 `thread/resume.history`에는 소스에 Cloud 전용·불안정·사용하지 말라는 경고가 있어 일반 이관의 안정 API로 추천하지 않는다. [inject 공식 테스트](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/tests/suite/v2/thread_inject_items.rs#L48), [history 경고](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L354).

</details>

<details>
<summary>4. 대화 밖의 문맥: 첨부·하위 에이전트·파일·지침을 별도 구성요소로 보관</summary>

- **첨부:** 이미지·PDF·도구 결과의 파일 참조는 텍스트 설명만으로 대체하지 않는다. 보관 가능한 원본 자산을 해시로 묶고 상대 경로·MIME·메시지 연결을 기록한다. 임시 URL·사라진 파일·미지원 형식은 누락으로 표시한다. 대상 모델에 이미지를 실제 이미지 입력으로 보낼 수 있는지 따로 검사한다. Codex는 image/localImage 입력을 받지만 이것이 기존 cross-client 변환이 이미 지원한다는 뜻은 아니다. [입력 형식](https://learn.chatgpt.com/docs/app-server#turns), [현재 공통 타입이 텍스트 중심인 근거](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/types.ts).
- **하위 에이전트:** 부모에게 반환된 요약과 자식 내부 기록을 분리한다. 자식마다 부모 ID·역할·마지막 상태·원본 참조를 붙이고 부모 이력의 중복 복사를 제거한다. Codex 자체 migration에도 부모 이력의 대량 중복을 피하기 위한 하위 세션 처리가 있다. [`subagent.rs`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/thread-store/src/local/rollout_migration/subagent.rs).
- **파일 상태:** 세션은 파일시스템 snapshot이 아니다. HEAD·staged/unstaged 차이·관련 untracked 파일·빌드/테스트 결과를 별도 상태로 확인한다. 대화 속 ‘수정했다’는 주장보다 현재 파일 상태가 우선이다. [Claude의 세션/파일 구분](https://code.claude.com/docs/en/agent-sdk/sessions), [Codex revert가 파일을 되돌리지 않는 계약](https://learn.chatgpt.com/docs/app-server#revert-thread-history).
- **작업 문맥:** 목표·사용자 확정 결정·미완료 목록·검증 증거를 작은 인계 문서로 만들되 각각 원문 turn/event를 참조한다. 원래의 지침·도구 설정은 출처와 비교 항목으로 보관하고, 대상의 지침 우선순위나 권한을 조용히 덮어쓰지 않는다. 인증정보는 문맥 이관 대상이 아니다.
- **긴 문맥:** 즉시 전달할 현재 상태와 최근 관련 기록, 필요 시 읽을 전체 원문을 분리한다. 이는 원문 삭제·임의 요약 강제가 아니라 입력창 한도를 넘겨 중요한 끝부분이 사라지지 않도록 하는 전달 전략이다. 모델이 읽지 않은 첨부나 원문을 ‘이해 완료’로 처리하지 않는다. 이 항목들은 개선 제안이며 이번에 자산 수집이나 파일 snapshot을 실행하지 않았다.

</details>

<details>
<summary>5. 테스트를 ‘파일이 생김’에서 ‘원래 의도를 이어받음’으로 확장</summary>

- **보존 검사:** 원본 전체와 유효 계보 각각의 메시지·도구 호출/결과·첨부 개수, 연결 ID, 내용 해시를 비교한다. 빠진 항목·변환된 항목·원문에만 남긴 항목을 기록별로 보고한다. 단일 보존율 숫자로 이미지와 짧은 메시지의 차이를 숨기지 않는다.
- **재개 검사:** 두 도구 모두 임시 프로필과 로컬 모의 서버에서, 프로세스를 종료한 후 실제 재개 요청을 포착한다. 여러 페이지·되돌림·fork·compaction·이미지·서브에이전트·반복 질문·미확인 도구 결과·대상 경로 변경을 포함한다. Codex의 기존 검사는 목록/읽기 중심이므로 다음 모델 요청까지의 검사가 필요하다. [현재 검증 코드](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/test/native-probe.mjs), [공식 upstream의 요청 검증 예시](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/tests/suite/v2/thread_inject_items.rs).
- **왕복 검사:** Claude A→Codex B→A 또는 A의 fork를 최소 한 번 왕복한다. 새 요구와 결정이 남고, 취소한 결정은 부활하지 않고, 이미 수행한 부작용을 반복하지 않는지를 검사한다. tool 이름만 바꾸어 서로 다른 입력 schema가 같아졌다고 취급하지 않는다. [현재 이름 매핑 근거](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/types.ts).
- **증거 범위:** 로컬 모의 응답은 실제 모델의 이해나 비공개 추론 동일성을 증명하지 못한다. 필요하다면 별도 승인된 합성 과제로 요구 유지·완료 작업 재실행 방지·파일/테스트 결과를 평가한다. 이번에는 외부 모델을 호출하지 않았다.
- **버전 기록:** 요청한 fork·Claude·Codex 3개는 계속 한 조합으로 관리한다. SDK를 도입하면 SDK 버전·프로토콜/저장 방식·OS·변환기와 검증 fixture 해시를 추가 증거로 붙인다. 기존 CI 40893249603을 다시 확인한 결과 Windows는 성공, macOS job은 cancelled였으므로 macOS 통과로 기재하지 않는다. [실행 결과](https://github.com/superego18/sessionbridge/actions/runs/40893249603).

</details>

다음 구현 실험의 최소 범위는 **1번 유효 계보 복원 + 2번 원래 세션 복귀/변경분 전달**이다. 이 문서는 조사 결과이며 구현·설치·commit·push는 수행하지 않았다.
