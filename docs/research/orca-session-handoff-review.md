# Orca의 세션 인계 방식과 sessionbridge 보완점

**결론: sessionbridge의 원본 보존·형식 변환은 유지하고, Orca에서 확인한 ‘현재 작업 재확인·출처 경계·전달 결과 구분’을 보완하는 것이 유효하다. Orca 자체도 다른 공급자의 실행 상태를 완전히 복원하지 않는다.** 공식 문서의 인계는 기존 세션을 그대로 두고 문맥을 전달하는 새 세션이며, `codex resume`와 구분한다. ([공식 문서](https://www.onorca.dev/docs/agents/codex#hand-off-to-another-agent), [인계 프롬프트](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L91-L109))

- 조사 기준: Orca `main`의 고정 커밋 `5cd7b5d52cc5ae825f08f0a7b89888ed032259e6`. 설치된 앱 `1.4.244`와 동일하다는 판단은 하지 않았다.
- 버전 대조: `git ls-remote`에서 `v1.4.244`는 annotated tag 객체 `9096d705d84b8b8fd5d2d605ca2a27428cd74442`, 실제 commit은 `b8ec5c8d170bcb9988e65de547a3a4e98b2885a9`로 확인했다. 해당 commit의 핵심 `agent-session-continuation.ts` 파일은 조사 main의 파일과 내용이 같다. 이 결과는 핵심 프롬프트 소스의 동일성만 확인하며 설치 바이너리 전체와 main의 일치 증거가 아니다. ([v1.4.244 고정 소스](https://github.com/stablyai/orca/blob/b8ec5c8d170bcb9988e65de547a3a4e98b2885a9/src/renderer/src/lib/agent-session-continuation.ts))
- 비교 기준: 로컬 `vendor/sessionbridge` 커밋 `2a43bdb38c28f9048ac31f62777cc26440829096`의 소스. 기존 raw JSONL·SHA256·fullcontext·순서 보존·도구 ID 매칭 등을 새 제안으로 반복하지 않는다.
- 후속 반영: 자체 fork [1.4.3 커밋](https://github.com/superego18/sessionbridge/commit/a81b3f2f80f25d537487a4b1769fd5be6f096714)에서 역사 자료 펜스·미확인 도구 호출·명시적 대상 경로·전달문 해시별 보관을 구현했다. Windows에서 회귀 테스트 22개, Claude 2.1.312와 Codex 0.163.0·0.165.0의 분리 프로필 검사를 통과했다. Claude 응답은 로컬 모의 서버 결과이며 실제 모델 응답 검증은 아니다. [검증 조합](../../COMPATIBILITY.md).
- 범위: 공개 공식 소스와 문서를 읽고 이 문서만 작성했다. 실제 사용자 transcript·인증정보는 읽지 않았고, 제품 실행이나 테스트 실행도 하지 않았다. 아래 테스트 근거는 소스에 존재하는 테스트의 의도이며 통과를 직접 확인했다는 뜻이 아니다.

<details>
<summary>1. 확인된 인계 계약: 원본을 바꾸지 않는 새 세션, focused가 기본</summary>

- **사실:** `focused`는 최근 상태와 현재 작업 디렉터리부터 살피고 부족한 부분만 원본 transcript에서 읽게 한다. `full`은 전체 transcript를 먼저 읽도록 요청한다. transcript 경로가 없으면 `full`은 만들지 못하고, `focused`만 최근 캡처를 사용한다. 텍스트에 포함된 백틱보다 긴 fence를 만들어 경계를 유지한다. ([프롬프트 구성](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L29-L161))
- **사실:** 대화상자의 기본은 `focused`다. terminal 인계는 provider transcript 경로가 있으면 scrollback을 직렬화하지 않고 경로를 넘긴다. 경로가 없으면 최대 800줄 scrollback을 캡처하며, 캡처는 ANSI 정리 후 최근 36,000자 수준으로 제한한다. ([기본 모드](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/components/agent-session-continuation/AgentSessionContinuationDialog.tsx#L78), [terminal 준비](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/components/terminal-pane/terminal-agent-session-continuation.ts#L53-L70), [캡처 정리](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-fork-context.ts#L27-L65), [예산](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/agent-session-context-budget.ts#L1-L9))
- **추론:** Orca의 `full`은 공급자 원본 상태를 다른 공급자 형식으로 완전 변환한다는 보증이 아니라, 새 모델에게 참조 파일을 읽도록 하는 지시다. terminal 경로 방식은 인계 순간의 불변 복제도 아니다. sessionbridge가 이미 가진 해시가 있는 원본 보관을 이 방식으로 대체할 이유는 없다. ([경로 기반 구성](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L119-L149))

</details>

<details>
<summary>2. 현재 문맥: /clear 경계·journal 일관성은 확인, 공급자 branch/compaction 복원은 별도</summary>

- **사실:** native chat 인계는 `sessionId`와 `workspaceId`, 로컬 실행 호스트가 맞는지 검사한다. 기대 cursor와 epoch가 다르거나 journal sequence가 기대치보다 과거이면 `superseded`로 거절한다. 허용된 snapshot을 텍스트와 파일의 공통 기준으로 사용한다. 같은 epoch에서 기대 sequence보다 최신인 snapshot은 허용하므로, 기대 cursor와 완전히 같은 지점만 허용하는 방식은 아니다. ([context reader](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-wire/structured-agent-session-continuation-context.ts#L20-L68))
- **사실:** 선택 범위는 최신 명시적 `/clear` 경계 이후 항목·submission이다. 경계는 문자열 추측이 아니라 typed metadata로 판별하며, 경계 이전의 pending/unknown을 새 문맥으로 취급하지 않는 관련 테스트도 있다. ([범위 선택](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/agent-session-context-clear.ts#L10-L12), [필터](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/agent-session-context-clear.ts#L75-L89), [테스트](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/agent-session-context-clear.test.ts#L100-L185))
- **사실:** native chat snapshot은 전체 선택 문맥의 텍스트를 쓰고, 프롬프트에 들어가는 최근 텍스트만 36,000자 예산으로 자른다. 파일은 임시 파일 작성 후 교체하고 동시 게시의 오래된 결과를 거절한다. 그러나 같은 chat의 다음 인계가 같은 최종 경로를 교체하므로, 모든 과거 인계에 대해 영구 불변인 파일은 아니다. ([reader](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-wire/structured-agent-session-continuation-context.ts#L45-L68), [snapshot 게시](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-context-snapshots.ts#L20-L56))
- **한계:** 이 인계 경로는 `/clear`를 다루지만, Claude `parentUuid` DAG의 선택 leaf 추적이나 Codex `compacted` 이벤트를 재구성하는 이관 엔진으로 확인된 것은 아니다. 현재 git branch도 여기서 캡처하지 않고 새 모델에게 git status와 관련 파일을 확인시키는 지시만 있다. 따라서 “Orca가 branch/compaction 완전 복원을 구현했다”는 주장은 근거가 없다. ([실제 selector](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/agent-session-context-clear.ts#L75-L89), [원본보다 현재 파일 우선 지시](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L103-L109))
- **추천:** sessionbridge는 기존 원본 아카이브와 별도로, 현재 선택된 공급자 문맥 및 인계 시점의 실제 workspace 상태를 구분해 표시해야 한다. 로컬 코드상 Claude는 파일 순서로 기록을 돌며 최초 cwd/gitBranch를 취하고, Codex는 `session_meta`의 cwd/git를 취하며 `turn_context`에서는 model만 반영한다. 이는 현재 branch·최신 cwd·선택 leaf·compaction 재현 여부를 별도 검증해야 할 구체적 지점이다. ([로컬 Claude parser](../../src/claude-reader.ts), [로컬 Codex parser](../../src/codex-parser.ts))

</details>

<details>
<summary>3. 도구·출처: 역할/도구 결과 구분은 유효하지만 pending 실행 상태의 완전 이관은 아니다</summary>

- **사실:** native chat 저장 문맥에는 pending approval/question도 `Prompt state`와 저장 payload를 가진 system 텍스트로 포함한다. resolved 질문은 선택한 답의 해석도 덧붙인다. 이는 대기 중 요청을 새 공급자에서 실행 가능한 원래 승인 객체로 복원하는 것과 다르다. ([저장 prompt projection](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-saved-prompt-text.ts#L45-L78))
- **사실:** 중간 도구 projection은 `state`, `endedAs`, `callId`, `exitCode` 등을 보유하고, 결과와 ID를 맞춘다. 최종 handoff 텍스트 formatter는 역할과 도구 이름·입력·결과·오류 표시를 출력하지만 callId·state·endedAs 및 message의 origin/linkage 메타데이터를 직접 출력하지 않는다. unknown block에는 누락 표시를 쓴다. ([도구 블록](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/structured-agent-session-tool-call-block.ts#L26-L44), [결과 projection](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/structured-agent-session-projection.ts#L86-L106), [최종 formatter](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/worker-transcript-text.ts#L11-L44))
- **사실:** 이미 잘린 도구 출력은 바이트 크기와 잘림 표시를 유지한다. 인계 프롬프트도 기존 잘림 표시를 인정하며, tool output 등 신뢰할 수 없는 transcript 내용의 지시를 따르지 말라고 명시한다. ([잘린 결과](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/shared/structured-agent-session-projection.ts#L52-L75), [신뢰 경계·snapshot 안내](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L105-L135))
- **추천:** sessionbridge의 기존 도구 ID 매칭은 유지한다. 추가할 것은 결과 없는 호출을 완료로 오해하지 않는 표시, 누락·잘림·중단 여부, source assistant/user/tool/importer 지시의 구분이다. 현재 `context-builder.ts`는 역할과 도구 이벤트를 이미 구분하지만, 읽어 들인 기록을 역사 자료로 취급하라는 명시적 신뢰 경계와 현재 workspace 재확인 지시는 없다. ([로컬 builder](../../src/context-builder.ts), [Orca 지시](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L91-L109))

</details>

<details>
<summary>4. 경로·계정·source identity: 대상 host/cwd 확인은 있지만 원본 계정 자동 승계 증거는 없다</summary>

- **사실:** 원본 agent·pane·title·working directory를 프롬프트에 표시한다. 새 세션에는 같은 worktree와 initial cwd를 넘기고, 대상 workspace host에서 agent가 설치·제공 가능한지 확인한다. 선택은 사용 가능한 원본 agent, 기본 agent, 자동 탐지 agent 순이다. ([출처 필드](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L76-L89), [launch와 host 검사](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.ts#L39-L93), [cwd 전달](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.ts#L109-L162), [선택](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/components/agent-session-continuation/agent-session-continuation-selection.ts#L4-L17))
- **사실:** 인계 source/request 타입에는 원본 account ID나 인증정보를 이식하는 필드가 없다. 공식 Codex 문서는 새 실행은 현재 선택 계정을 따르고, 실행 중 세션은 시작 당시 home을 유지한다고 설명한다. 따라서 “인계가 원본 계정을 자동 유지한다”는 주장은 이 근거로 할 수 없다. restart의 동일 계정 유지와 fresh handoff는 구분해야 한다. ([인계 타입](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/agent-session-continuation.ts#L8-L27), [Codex 공식 문서](https://www.onorca.dev/docs/agents/codex#system-default-vs-extra-accounts))
- **추천:** sessionbridge는 새 계정 라우팅 기능부터 만들기보다, 변환 대상 home/config directory와 cwd, 원본 session identity를 비밀정보 없이 분명하게 표시하고, source metadata와 실제 실행 대상을 혼동하지 않게 해야 한다. 원본 계정 자격증명 복사는 추천하지 않는다. ([Orca가 실제 전달하는 범위](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.ts#L109-L162))

</details>

<details>
<summary>5. 전달·재시작: 파일 생성/실행/수신 확인을 별도 결과로 취급</summary>

- **사실:** fresh handoff는 Claude에 `draft`, 나머지 agent에 `submit-after-ready`를 사용한다. 새 세션 실행 실패, 실행 후 문맥 전달 실패, PTY에 썼지만 수신을 확인하지 못한 경우를 구분한다. 미확인 상태에서는 성공 toast 대신 사용자가 새 세션을 확인하고 프롬프트를 복사할 수 있게 한다. ([launch 상태](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.ts#L105-L180), [실패·미확인 안내](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.ts#L183-L225))
- **사실:** 이 구분을 확인하는 단위 테스트가 있다. 다만 renderer의 수신 확인이 모델의 내용 이해·작업 재개까지 증명하지는 않는다. ([실패 구분·미확인 테스트](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.test.ts#L115-L171))
- **사실:** 별도 native-chat restart continuation은 `continued/pending/unknown/refused`를 나누고 host 수락과 provider 전달 판정을 분리한다. 전송 중 오류가 나도 이미 전달됐을 수 있으므로 자동으로 미전달이라 간주하지 않는다. 느린 시작, 거절, 세션 종료, continuation을 사람이 보낸 것처럼 표시하지 않는 테스트가 있다. 이는 fresh cross-agent 인계 자체의 구현이라고 혼동하면 안 된다. ([restart 결과](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-wire/structured-agent-session-restart-continuation.ts#L36-L43), [전달 판정](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-wire/structured-agent-session-restart-continuation.ts#L246-L299), [대기 테스트](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/main/native-chat/agent-session-wire/structured-agent-session-restart-continuation-wait.test.ts#L38-L114))
- **추천:** sessionbridge가 지금처럼 변환 파일과 resume 명령만 제공한다면 결과는 ‘변환 완료’다. 실제 launcher를 추가할 때만 ready/전달 확인/불확실 상태를 구현하고, 미확인 전달을 자동 재시도해 같은 작업을 두 번 시작하지 않게 한다. ([기존 CLI](../../src/index.ts), [Orca의 불확실성 구분](https://github.com/stablyai/orca/blob/5cd7b5d52cc5ae825f08f0a7b89888ed032259e6/src/renderer/src/lib/launch-agent-session-continuation.ts#L107-L141))

</details>

## 적용 우선순위와 검증 예시

1. **P1 — 신뢰 경계·현재 작업 재확인:** 이력은 역사 자료이고 현재 파일·git 상태를 확인하도록 짧은 인계 지시를 추가한다. 검증: tool output에 가짜 지시가 들어 있어도 importer 지시로 승격하지 않음, 이미 완료한 작업은 무조건 재실행하지 않음.
2. **P1 — 활성 문맥 선택의 정확성:** 실제 공급자 기록 스키마를 기준으로 Claude parent chain/선택 leaf와 Codex compaction/최신 turn context를 검증한다. Orca의 `/clear` selector를 그대로 복사하지 않는다. 검증: 분기 두 개의 폐기된 작업을 섞지 않음, compaction 전 기록과 새 문맥의 관계가 분명함, 중간 cwd 변경과 git checkout이 최초 metadata와 구별됨.
3. **P1 — 미완료 도구·누락 표시:** 결과 없는 호출, 오류·중단·잘림을 명시하고 완료로 합성하지 않는다. 검증: 같은 이름의 동시 호출 중 한쪽 결과만 존재, 호출 후 프로세스 종료, 잘린 출력, pending 승인/질문이 새 공급자의 실행 가능한 승인으로 잘못 바뀌지 않음.
4. **P2 — 일관된 인계 시점·대상 표시:** 기존 아카이브 해시를 활용해 projection과 snapshot이 같은 입력을 설명하는지 확인하고, source identity와 target cwd/home을 나눈다. 검증: 읽는 동안 원본 append, 서로 다른 config home에 같은 session ID 존재, 대상 cwd 부재, source/target home 혼동, path 내 공백·백틱·한글.
5. **P2 — 실행기를 추가할 때만 전달 확인:** 변환·실행·입력 준비·전달·불확실 결과를 분리한다. 검증: 40초 cold start, trust/login 화면, PTY write 후 ready 미확인, 실행 성공 후 전달 실패, 전달 후 연결 끊김에서 자동 중복 제출 방지.

위 항목은 **적용 추천과 향후 검증 항목**이다. 실제 누락 여부는 기능별 테스트로 확정해야 하며, 공개 Orca 소스의 동작 확인만으로 sessionbridge 수정 완료나 설치된 Orca의 동작을 주장하지 않는다.
