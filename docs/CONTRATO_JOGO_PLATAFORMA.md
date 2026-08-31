# Como um jogo conversa com a plataforma Atesteme

Guia para (1) migrar os jogos que já existem e (2) servir de template para os próximos.
Escrito para ser executável por uma IA: cada seção diz o que fazer, onde, e como
conferir que funcionou.

**A regra que resume tudo:** o jogo não conhece a Atesteme. Ele só emite eventos
contando o que aconteceu na partida. Quem traduz isso em "aprovado" ou "reprovado" é a
camada de embed (`src/pages/EmbedGamePage.tsx`), num lugar só. Se um dia a regra de
aprovação mudar, muda ali — não em 46 jogos.

---

## 1. Onde estamos hoje

Auditoria dos 46 jogos em `src/games/` (agosto/2026):

| Item | Situação |
|---|---|
| Usa `runtimeGameBridge` | **46/46** |
| Emite `GAME_READY` | **46/46** |
| Emite `GAME_COMPLETED` | **46/46** |
| Emite `CORRECT_ANSWER` / `WRONG_ANSWER` | **46/46** |
| Emite `CHECKPOINT` | 40/46 — faltam 6 |
| Emite `GAME_OVER` próprio | 15/46 — **e está tudo bem**, ver §3.4 |
| Declara quantas fases tem | **4/46 — este é o problema real, ver §3.5** |

O contrato está quase todo implementado. O que falta é pontual, e um item é sério.

### O que já mordeu, e não pode repetir

**`oficina-dos-algoritmos` estava mudo.** Era o único dos 46 importando `gameBridge` em
vez de `runtimeGameBridge`. `gameBridge.emit` só fala com a própria página; a plataforma
nunca recebeu nem o `GAME_READY`. O aluno jogava a partida inteira e o desafio não
aprovava nem reprovava. Já corrigido — mas o modo de falha é o pior possível: **o jogo
funciona perfeitamente e não entrega nada.** Nada na tela denuncia.

---

## 2. O que a plataforma faz com cada evento

```
GAME_COMPLETED + isFinalStage: true   ->  APROVADO
GAME_OVER                             ->  REPROVADO
WRONG_ANSWER x (vidas da query)       ->  REPROVADO
```

Só isso decide a nota. Todo o resto é telemetria.

O `attempt` da query volta em `meta.attempt` como **eco exato** — é assim que a
plataforma sabe de qual tentativa é o resultado. O jogo nunca precisa tocar nesse valor:
quem preenche `meta`, `totalStages` e `isFinalStage` é
`src/shared/bridge/outgoingEvent.ts`, a partir da sessão de embed.

---

## 3. O contrato, evento por evento

Os tipos ficam em `src/shared/contracts/platformEvents.ts`. Emita sempre por
`runtimeGameBridge.emit({ ... })`.

### 3.1 `GAME_READY` — obrigatório

```ts
runtimeGameBridge.emit({ type: 'GAME_READY', gameId: GAME_ID })
```

Uma vez, quando o jogo está pronto para jogar. Normalmente no `create()` da cena
principal.

> **Atenção:** `create()` roda de novo a cada `scene.restart()` — ou seja, uma vez por
> fase. A camada de sessão já deixa passar **só o primeiro** `GAME_READY` de cada
> tentativa (`primeiroProntoDaTentativa()`), porque quem está de fora usa esse evento
> como autorização para mandar `START_GAME`, e três autorizações virariam três
> `START_GAME` no meio da partida. Você não precisa se defender disso — só não invente
> um mecanismo próprio de "já emiti".

### 3.2 `GAME_COMPLETED` — obrigatório

```ts
runtimeGameBridge.emit({
  type: 'GAME_COMPLETED',
  gameId: GAME_ID,
  stage: this.nivelAtual,      // 1, 2, 3... — a fase que ACABOU de ser concluída
  totalStages: TOTAL_DE_FASES, // ver 3.5 — declare sempre
  score: this.pontos,          // opcional
  errors: this.erros,          // opcional
  durationMs: this.duracao,    // opcional
})
```

**Emitido a cada fase concluída, não só no fim.** Quem distingue "terminou a fase 1" de
"terminou o jogo" é `isFinalStage`, preenchido pela camada de saída. Nunca aprove nada
por conta própria.

`stage` precisa ser o número real da fase, começando em 1. Se vier errado, a aprovação
sai na hora errada.

### 3.3 `CORRECT_ANSWER` / `WRONG_ANSWER` — obrigatórios

```ts
runtimeGameBridge.emit({ type: 'CORRECT_ANSWER', gameId: GAME_ID, pointsEarned: 10, stage })
runtimeGameBridge.emit({ type: 'WRONG_ANSWER',   gameId: GAME_ID, pointsEarned: 0,  stage })
```

`WRONG_ANSWER` **não é telemetria** — é o que alimenta a contagem de vidas, e é por ele
que a maioria dos jogos consegue reprovar (§3.4). Um jogo que não emite `WRONG_ANSWER` é
um jogo em que ninguém reprova nunca.

Emita **um por erro real do aluno**. Não emita em erro de arrastar, clique fora ou
tentativa cancelada — cada um desses custa uma vida.

### 3.4 `GAME_OVER` — só se o jogo tem derrota própria

31 dos 46 jogos não têm como perder: a criança erra, o jogo mostra o erro, a vida segue.
Na maioria deles insistir até acertar **é** o exercício, e inventar uma derrota mudaria
a proposta pedagógica.

Por isso a derrota mora fora do jogo. `EmbedGamePage` conta os `WRONG_ANSWER` e, quando
passam das `lives` que a plataforma mandou na query, emite o `GAME_OVER` pelo jogo. A
regra fica igual para os 46, e a plataforma ajusta o rigor sem editar nada: `lives=1` faz
"errou, perdeu"; `lives=5` dá cinco chances.

**Então:** emita `GAME_OVER` apenas se o seu jogo tiver uma condição de derrota de
verdade (tempo esgotado, vidas próprias, sequência quebrada). Se emitir, ele resolve a
partida e a contagem de fora nem chega a rodar.

```ts
runtimeGameBridge.emit({ type: 'GAME_OVER', gameId: GAME_ID, stage: this.nivelAtual })
```

### 3.5 Quantas fases o jogo tem — o item que falta em 42 jogos

Hoje, quando o jogo não diz nada, a camada de embed assume **3 fases** (`FASES_PADRAO`
em `EmbedGamePage.tsx`). Isso vem de um tempo em que todo jogo tinha três. Consequências
para quem não tem:

- jogo com **4+ fases** -> o aluno é **aprovado ao terminar a fase 3**, e o resto do jogo
  não conta;
- jogo com **2 fases** -> `stage` nunca chega a 3, `isFinalStage` nunca fica `true`, e o
  aluno **nunca é aprovado**, por mais que termine.

Nada na tela denuncia nenhum dos dois. **É a falha mais cara deste contrato hoje.**

A correção é declarar no próprio evento — o jogo é quem sabe da própria estrutura, e
`outgoingEvent.ts` respeita o que ele disser:

```ts
const TOTAL_DE_FASES = 5   // no topo do arquivo, junto do GAME_ID

runtimeGameBridge.emit({
  type: 'GAME_COMPLETED',
  gameId: GAME_ID,
  stage: this.nivelAtual,
  totalStages: TOTAL_DE_FASES,        // <- declare SEMPRE, mesmo quando for 3
})
```

Declare mesmo quando o número bater com o padrão. Um jogo que declara 3 continua certo
quando alguém mudar o padrão; um que se cala, não.

### 3.6 `CHECKPOINT` — recomendado

```ts
runtimeGameBridge.emit({
  type: 'CHECKPOINT', gameId: GAME_ID,
  progress: 0.5, score: this.pontos, stage, hits: this.acertos, errors: this.erros,
})
```

Não afeta a nota. Serve para a plataforma mostrar progresso e para diagnosticar partidas.
Falta em 6 jogos; é o item de menor prioridade da lista.

### 3.7 `gameId`: são dois, e são diferentes

- **no corpo do evento**: o **slug** (`'corrida-dos-parecidos'`) — informativo;
- **em `meta.gameId`**: o **id do catálogo** (`'046'`) — permanente, preenchido pela
  camada de saída, e é o que a Atesteme usa para vincular o desafio.

Nunca troque um pelo outro. Slug muda; id do catálogo, não.

---

## 4. Template para um jogo novo

```ts
// src/games/<COMPETENCIA>/<slug>/scenes/GameScene.ts

import { runtimeGameBridge } from '../../../../shared/bridge/runtimeGameBridge'
import type { PlatformCommand } from '../../../../shared/contracts/platformCommands'

/** O slug do jogo. O id do catálogo entra sozinho, em `meta.gameId`. */
const GAME_ID = 'meu-jogo'

/** Quantas fases este jogo tem. Concluir a última é o que aprova o aluno. */
const TOTAL_DE_FASES = 3

export class GameScene extends Phaser.Scene {
  private nivelAtual = 1
  private pontos = 0
  private acertos = 0
  private erros = 0
  private desinscrever?: () => void

  create() {
    // ...monta a cena...

    // Pronto para jogar. Pode rodar de novo a cada fase: a ponte cuida disso.
    runtimeGameBridge.emit({ type: 'GAME_READY', gameId: GAME_ID })

    // Opcional: reagir a comandos da plataforma.
    this.desinscrever = runtimeGameBridge.onCommand((comando: PlatformCommand) => {
      if (comando.type === 'PAUSE_GAME') this.scene.pause()
      if (comando.type === 'RESUME_GAME') this.scene.resume()
    })

    this.events.once('shutdown', () => this.desinscrever?.())
  }

  private aoAcertar(pontos: number) {
    this.pontos += pontos
    this.acertos += 1
    runtimeGameBridge.emit({
      type: 'CORRECT_ANSWER', gameId: GAME_ID, pointsEarned: pontos, stage: this.nivelAtual,
    })
    this.emitirCheckpoint()
  }

  /** Um por erro REAL do aluno: cada um custa uma vida. */
  private aoErrar() {
    this.erros += 1
    runtimeGameBridge.emit({
      type: 'WRONG_ANSWER', gameId: GAME_ID, pointsEarned: 0, stage: this.nivelAtual,
    })
    this.emitirCheckpoint()
  }

  /** Chamado ao concluir CADA fase — inclusive a última. */
  private aoConcluirFase() {
    runtimeGameBridge.emit({
      type: 'GAME_COMPLETED',
      gameId: GAME_ID,
      stage: this.nivelAtual,
      totalStages: TOTAL_DE_FASES,
      score: this.pontos,
      errors: this.erros,
    })
    // Não decida aprovação aqui. Quem decide é a camada de embed.
  }

  /** Só se o jogo tiver derrota própria (tempo, vidas internas...). */
  private aoPerder() {
    runtimeGameBridge.emit({ type: 'GAME_OVER', gameId: GAME_ID, stage: this.nivelAtual })
  }

  private emitirCheckpoint() {
    runtimeGameBridge.emit({
      type: 'CHECKPOINT',
      gameId: GAME_ID,
      progress: this.nivelAtual / TOTAL_DE_FASES,
      score: this.pontos,
      stage: this.nivelAtual,
      hits: this.acertos,
      errors: this.erros,
    })
  }
}
```

---

## 5. Checklist de migração — um jogo por vez

Para cada pasta em `src/games/<COMPETENCIA>/<slug>/`:

1. **Ponte certa.** O import é `runtimeGameBridge`, de
   `shared/bridge/runtimeGameBridge`? Se estiver `gameBridge`, troque — `.emit`
   continua `.emit`, e `.onPlatformCommand` vira `.onCommand`.
   Confira com `grep -rn "gameBridge" <pasta> | grep -v runtimeGameBridge`
   (tem que voltar vazio).
2. **Conte as fases de verdade.** Jogue ou leia os dados de nível. Escreva
   `const TOTAL_DE_FASES = <n>` e passe `totalStages` em todo `GAME_COMPLETED`.
   **Não presuma 3.**
3. **`stage` correto.** Todo evento com `stage` usa o número da fase atual, começando em
   1 — não um índice de array começando em 0.
4. **`GAME_COMPLETED` em toda fase.** Inclusive nas intermediárias.
5. **`WRONG_ANSWER` só em erro real.** Um por erro do aluno. Cada um custa uma vida.
6. **`GAME_OVER` só se houver derrota própria.** Sem condição de derrota, não emita — a
   camada de embed cuida.
7. **`CHECKPOINT`** onde fizer sentido (fim de fase, marco de progresso).
8. **Teste** pelo §6 antes de marcar como pronto.

### Quem ainda precisa de atenção

**Declaram o total de fases (4):** `trilha-do-passo-a-passo`, `missao-arquivo-seguro`,
`curadoria-com-creditos`, `academia-dos-algoritmos`.
**Os outros 42 não declaram** — todos precisam do passo 2.

**`CHECKPOINT` ausente (6):** `correio-multimidia`, `hangar-dos-modelos`,
`radar-de-confiabilidade`, `curadoria-com-creditos`, `futuro-em-cena`,
`escolha-a-ferramenta-certa`.

---

## 6. Como testar

### 6.1 Direto no navegador

```
https://games.atesteme.com/jogos/<slug>?embed=1&inline=1&stage=1&points=0&lives=3
```

`inline=1` roda sem tentativa e sem navegação — é o modo de conferência. Abra o console e
jogue: cada evento aparece. Se não aparecer nada, o jogo está mudo.

### 6.2 Pelo preview da Atesteme (o teste que vale)

No admin, em **Desafios -> preview (ícone de olho)** de um desafio automático, o jogo
abre em modo demonstração. Ao terminar, a plataforma mostra na tela:

> **O jogo reportou conclusão da fase final.** Numa tentativa de aluno, isto aprovaria o
> desafio.

É a confirmação de ponta a ponta. Se em 25 segundos nenhum evento chegar, aparece um
aviso dizendo isso — foi exatamente ele que denunciou o `oficina-dos-algoritmos`.

Uma limitação: em `inline=1` a contagem de vidas não roda (quem hospeda tem a economia
dele), então o preview não demonstra reprovação nos jogos que não emitem `GAME_OVER`
próprio. Para testar reprovação, use uma tentativa real com `lives=1`.

### 6.3 O que conferir

- [ ] `GAME_READY` chega **uma vez**, não uma por fase
- [ ] cada acerto e cada erro geram um evento, e só um
- [ ] `GAME_COMPLETED` chega ao fim de **cada** fase
- [ ] no fim da **última** fase, `isFinalStage: true`
- [ ] `stage` bate com a fase que apareceu na tela
- [ ] com `lives=1`, um erro reprova

---

## 7. Armadilhas

**A allowlist é de build.** Quem embute precisa estar em
`VITE_EMBED_ALLOWED_ORIGINS`, e essa variável entra no **bundle**: mudar o valor no
painel da Vercel sem republicar não muda nada. Ela aceita curinga de sufixo —
`https://*.atesteme.com` cobre todo subdomínio de parceiro sem exigir build novo a cada
venda.

**Lista vazia não é "liberado", é "nada entra e nada sai".** Um deploy que esqueceu a
variável falha visível, em vez de falhar aberto.

**Nunca `targetOrigin: "*"`.** O que trafega é desempenho de criança. Com `"*"`, qualquer
página que embutisse o site receberia tudo — basta um iframe num blog.

**Nunca decida aprovação dentro do jogo.** Sem `isFinalStage`, o `GAME_COMPLETED` da
fase 1 é idêntico ao da última. Aprovar por conta própria aprova na primeira.

**Porta do dev.** O `.env.local` costuma fixar `http://localhost:5173`. Se o Vite subir na
5174 porque a 5173 estava ocupada, o navegador descarta todas as mensagens em silêncio, e
o sintoma não parece com a causa: o jogo trava ao errar e a tela de derrota nunca aparece.

---

## 8. Onde ler o código

| Assunto | Arquivo |
|---|---|
| Tipos dos eventos | `src/shared/contracts/platformEvents.ts` |
| Tipos dos comandos | `src/shared/contracts/platformCommands.ts` |
| A ponte que os jogos usam | `src/shared/bridge/runtimeGameBridge.ts` |
| Quem preenche `meta` e `isFinalStage` | `src/shared/bridge/outgoingEvent.ts` |
| Quem decide aprovado/reprovado | `src/pages/EmbedGamePage.tsx` |
| Quem pode conversar com o site | `src/shared/bridge/allowedOrigins.ts` |
| Parâmetros da URL de embed | `src/platform/embed/embedParams.ts` |
