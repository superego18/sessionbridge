# Claude 세션 이관의 다음 보완점 · 2026-10-30

**추천: 원래 Claude 세션을 보존하고 돌아올 때 native resume/fork에 Codex 구간의 변경분을 전달한다. 새 대상을 만들 때는 공식 SDK로 현재 유효 대화 체인을 읽고, 전체 원본·첨부·서브에이전트는 별도로 보관한다.** 이는 조사에 따른 제안이며 이번 작업에서 구현하거나 실제 모델로 검증하지 않았다.

- 현재 기준: 자체 fork `a81b3f2f80f25d537487a4b1769fd5be6f096714`(1.4.3), 직접 읽은 `src/claude-reader.ts`, `src/types.ts`, `src/claude-writer.ts`.
- 직접 재현: 합성 JSONL의 되감기 전·후 가지가 모두 사용자 턴으로 변환됐고, 이미지 블록만 있는 사용자 입력은 0턴으로 변환됐다. 사용자 실제 대화·인증정보는 읽지 않았다.
- 공개 소스 기준: Python SDK commit `27858cbba9ecee26a06a90b8d39d3b5596121d11`(pyproject 0.2.174), TypeScript SDK commit `e2963809c50847f00143646418177031aa38dd9c`(changelog 최신 0.3.312). 문서·소스 확인과 설치 버전의 동작 검증은 다르다.

| 우선순위 | 다음 보완 | 이번 조사에서 확인한 근거 |
| --- | --- | --- |
| 1 | 돌아갈 때 원본 native 세션 + 변경분 | 공식 resume/fork가 원래 공급자의 기록을 재사용한다. 교차 공급자 전체 상태 변환은 보장하지 않는다. |
| 2 | 현재 체인과 전체 원본 분리 | 공식 helper는 `parentUuid`를 따라 현재 체인을 고른다. 자체 reader는 모든 줄을 순서대로 읽는다. |
| 3 | 이미지·서브에이전트 동봉 | 현재 공통 타입은 텍스트 중심이고 archive는 단일 JSONL이다. 공식 SDK에 첨부 입력과 서브에이전트 조회가 있다. |
| 4 | 파일 상태와 대화 상태 분리 | Claude checkpoint는 대화나 전체 작업 디렉터리 백업과 다르다. |
| 5 | SDK 버전까지 포함한 재개 검증 | 공식 changelog에 rewind·compaction·중간 입력 조회 누락 수정이 있다. |

<details>
<summary>1. 우선 제안: Claude → Codex → Claude 왕복을 ‘원본 재개 + 변경분’으로 구성</summary>

- **공식 사실:** `resume`은 지정한 기존 세션을 이어 쓰고, fork는 원본을 유지하며 별도 세션을 만든다. 세션은 대화 기록을 보관하며 파일시스템 자체를 보관하지 않는다. 공식 문서도 분석 결과·결정·diff를 애플리케이션 상태로 보관해 새 프롬프트로 전달하는 방식을 더 견고한 대안으로 제시한다. ([공식 세션 문서](https://code.claude.com/docs/en/agent-sdk/sessions))
- **조사 제안:** Claude에서 나갈 때 원본 세션 ID·마지막 유효 메시지 UUID·원본 해시·코드 기준점을 기록한다. 돌아올 때 원래 Claude 세션을 resume하거나 fork하고, Codex 구간의 사용자 변경 지시·결정·수행 결과·파일 변경·실패/미확인 작업만 새 인계 자료로 제공한다.
- **효과에 대한 추론:** 기존 Claude 기록을 Codex를 거쳐 다시 Claude 형식으로 변환하지 않으므로, 왕복 변환으로 원래 기록을 손상시키거나 중복 삽입하는 지점을 줄인다. Codex에서 읽을 수 없는 Claude 고유 상태를 Codex로 이식할 수 있다는 뜻은 아니다.
- **조건:** 원래 세션이 남아 있고 원본 해시·전환 기준점이 확인돼야 한다. 원래 세션이 동시에 진행됐다면 자동 병합하지 말고 두 구간의 분기 차이를 먼저 표시한다. 파일은 최신 실제 working tree와 대조한다. 원본 native 상태가 그대로 재현된다는 실증은 아직 없다.
- **피할 것:** 돌아올 때 양쪽 전체 대화를 매번 다시 주입해 같은 지시·도구 결과를 겹치게 하거나, 원래 Claude 세션을 새 합성 세션으로 대체하는 것을 기본값으로 삼지 않는다.

</details>

<details>
<summary>2. 현재 체인 선택: JSONL 파일 순서 전체를 ‘현재 대화’로 취급하면 안 됨</summary>

- **직접 코드 확인:** 자체 `parseClaudeSession()`은 `records` 전체를 파일 순서로 순회한다. `parentUuid`, `isSidechain`, `isMeta`, compact boundary를 기준으로 선택하지 않는다. 해당 필드가 있어도 현재 사용자 입력·응답과 철회된 가지를 구분하지 않는다. ([고정 자체 reader](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/claude-reader.ts))
- **직접 합성 재현:** `u1 → a1 → u2-old → a2-old` 이후 `a1 → u2-new → a2-new`를 같은 파일에 썼을 때 자체 reader의 사용자 메시지는 `[root, ABANDONED, CURRENT]`였다. 이는 파일의 모든 기록을 보관하는 것과 현재 대화를 모델에 재생하는 것이 다름을 보여 준다. 임시 파일만 생성·삭제했고 제품 코드는 바꾸지 않았다.
- **공식 소스 사실:** Python `get_session_messages()`의 `_build_conversation_chain()`은 `parentUuid`로 root→leaf를 선택하며, 병렬 도구 때문에 체인 밖으로 갈라진 호출·결과는 같은 응답/작성자 기준으로 복구한다. `logicalParentUuid`를 따라 압축 전 메시지를 되살리지 않으며 compact summary는 남긴다. ([고정 공식 구현](https://github.com/anthropics/claude-agent-sdk-python/blob/27858cbba9ecee26a06a90b8d39d3b5596121d11/src/claude_agent_sdk/_internal/sessions.py), [폐기된 가지·병렬 도구 테스트](https://github.com/anthropics/claude-agent-sdk-python/blob/27858cbba9ecee26a06a90b8d39d3b5596121d11/tests/test_sessions.py))
- **공식 문서 사실:** `getSessionMessages({ sessionStore })`는 압축 이후 재개에 쓰이는 연결 체인을 반환한다. 압축 전 원문·메타데이터를 포함한 전체 기록은 `store.load(key)`로 읽는다. ([현재 체인과 raw 구분](https://code.claude.com/docs/en/agent-sdk/session-storage#getsessionmessages-returns-the-post-compaction-chain))
- **조사 제안:** `raw archive`(전부 보관), `current context`(현재 유효 체인), `searchable history`(과거 가지·압축 전 기록의 출처 포함 조회)를 나눈다. 기본 재개는 current를 사용하고 필요할 때 과거를 검색한다. ‘모든 것을 유지’하기 위해 철회한 지시까지 다시 활성화해서는 안 된다.

</details>

<details>
<summary>3. 이미지와 서브에이전트: 텍스트 변환 밖의 기록을 묶어 보관</summary>

- **직접 코드 확인:** 자체 reader는 사용자 배열에서 `type === "text"`만 골라 문자열로 합친다. 공통 `ParsedTurn`에는 이미지·문서·첨부·서브에이전트 연결 필드가 없다. 이미지 블록만 있는 합성 사용자 메시지를 넣으면 `turns.length === 0`이었다. 이는 파서의 블록 누락 재현이며 유효 PNG를 모델에 전달한 시각 테스트가 아니다. ([reader](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/claude-reader.ts), [공통 타입](https://github.com/superego18/sessionbridge/blob/a81b3f2f80f25d537487a4b1769fd5be6f096714/src/types.ts))
- **공식 사실:** Claude SDK streaming input은 image 블록을 받으며, 공식 예시는 media type과 base64 데이터를 함께 전달한다. 이미지가 단지 텍스트 파일 경로로 언급되는 것과 실제 첨부되는 것은 다르다. ([공식 이미지 입력](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode#streaming-input-mode-recommended))
- **공식 사실:** 서브에이전트 transcript는 부모와 별도 파일로 유지된다. 재개에는 부모 세션·agent identity가 필요하다. Python `get_subagent_messages()`는 `.meta.json`의 parent tool/agent 연결을 읽는다. `import_session_to_store()`는 기본적으로 서브에이전트 JSONL과 메타데이터 sidecar도 수집한다. ([공식 서브에이전트 문서](https://code.claude.com/docs/en/agent-sdk/subagents#resume-subagents), [고정 조회 구현](https://github.com/anthropics/claude-agent-sdk-python/blob/27858cbba9ecee26a06a90b8d39d3b5596121d11/src/claude_agent_sdk/_internal/sessions.py), [고정 import 구현](https://github.com/anthropics/claude-agent-sdk-python/blob/27858cbba9ecee26a06a90b8d39d3b5596121d11/src/claude_agent_sdk/_internal/session_import.py))
- **조사 제안:** 이미지 원본 bytes/MIME/hash, transcript 내 위치, 서브에이전트 ID·부모 호출·원본 transcript·마지막 상태를 manifest로 묶는다. 부모 모델에는 결과와 필요 시 조회 경로를 먼저 제공하며 모든 하위 대화를 부모 문맥으로 평탄화하지 않는다. 대상이 실제 이미지 입력을 지원하면 첨부하고, 지원하지 않으면 누락을 명시한다.
- **한계:** Claude의 살아 있는 서브에이전트 프로세스·권한·세션 identity를 Codex의 실행 중 에이전트로 그대로 되살릴 수 있다는 공식 근거는 찾지 못했다. ‘기록 보관/조회’와 ‘프로세스 재개’는 다르다.

</details>

<details>
<summary>4. 공식 API를 쓰면 내부 파일 직접 조작을 어디까지 줄일 수 있나</summary>

- **가능:** 세션 목록·메타데이터·현재 메시지·하위 에이전트 조회와 같은 공급자 내 resume/fork를 공식 SDK helper로 처리할 수 있다. 다중 profile 환경에서는 helper 프로세스의 `CLAUDE_CONFIG_DIR`도 정확히 맞춰야 한다. subprocess 옵션에만 주고 helper를 다른 환경에서 실행하면 서로 다른 저장소를 읽을 수 있다. ([공식 storage의 helper 환경 주의](https://code.claude.com/docs/en/agent-sdk/session-storage#the-sessionstore-interface), [공식 목록/조회 안내](https://code.claude.com/docs/en/agent-sdk/sessions#resume-across-hosts))
- **가능하지만 범위 제한:** SessionStore는 Claude transcript를 저장소로 mirror하고 다른 호스트의 Claude가 재개하게 한다. `append/load`는 opaque entry를 순서대로 보존해야 한다. 하위 transcript 복원에는 `listSubkeys`가 필요하고 파일 checkpoint는 mirror 대상이 아니다. 이는 Codex→Claude 범용 변환 API가 아니다. ([공식 SessionStore](https://code.claude.com/docs/en/agent-sdk/session-storage), [고정 import 소스](https://github.com/anthropics/claude-agent-sdk-python/blob/27858cbba9ecee26a06a90b8d39d3b5596121d11/src/claude_agent_sdk/_internal/session_import.py))
- **보장 불가:** SDK를 사용한다고 모든 네이티브 저장 형식 문제나 손실이 사라지지는 않는다. TypeScript changelog에는 0.3.283~0.3.285에서 rewind된 가지 선택, 일부 메시지를 보존한 compaction 이후 fork, 작업 중 보낸 입력 누락을 고친 이력이 있다. 확인한 0.3.312는 Claude Code 2.1.312와의 parity를 명시한다. ([고정 공식 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/e2963809c50847f00143646418177031aa38dd9c/CHANGELOG.md))
- **조사 제안:** 기존 세 버전(포크·Claude·Codex)에 더해 SDK를 도입할 경우 adapter/SDK 버전·소스 hash를 검증 증거에 포함한다. CLI binary 버전과 SDK가 번들하는 CLI 버전도 별도로 확인한다.

</details>

<details>
<summary>5. 다음 검증은 ‘변환 파일 생성’보다 재개 의미가 같은지 확인</summary>

- **현재 가지:** 폐기된 지시와 최신 지시가 충돌하는 fixture를 만들고, 현재 지시만 native 재개 요청에 들어가며 과거 가지는 archive에서 조회되는지 확인한다. 병렬 도구의 모든 결과는 함께 남아야 한다.
- **압축 전/후:** compact summary·kept segment가 있는 원본의 공식 helper 결과와 자체 projection을 비교한다. 압축 전 상세는 보관하되 모델 현재 입력에 이중으로 들어가지 않는지 검사한다.
- **첨부/하위 작업:** 실제 합성 PNG의 bytes와 MIME이 대상 요청에 포함되는지, 서브에이전트의 부모 연결·완료/미완료 결과·조회 가능한 원문이 남는지 확인한다.
- **왕복 변경분:** Claude의 전환 기준점 이후 Codex에서 새로 결정한 내용만 가져오며, 한 번 전달한 구간을 두 번 적용하지 않는지 확인한다. 원본이 동시에 바뀌면 충돌로 표시해야 한다.
- **파일 실제 상태:** 커밋·tracked diff·선택한 untracked 파일·검증 명령 결과를 대화와 따로 비교한다. Claude checkpoint는 모든 Bash/외부/서브에이전트 변경을 포괄하는 전체 저장소 백업이 아니므로 Git 또는 파일 manifest를 별도로 써야 한다. ([공식 checkpoint 한계](https://code.claude.com/docs/en/checkpointing#limitations))

이번 작업은 조사와 파서의 합성 2사례 재현만 수행했다. SDK 설치, 실제 세션 변환, 실제 모델 호출, 제품 코드 수정, 커밋·push는 하지 않았다.

</details>
