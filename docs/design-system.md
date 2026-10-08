# PokeBoard Retro — design system

Cada tela é uma Pokédex de bolso dos anos 90: a carcaça vermelha é a moldura, o conteúdo vive numa "tela" escura e os dados aparecem como num Game Boy. A cor forte vem dos Pokémon (as 18 cores de tipo); a interface em volta é contida.

Os tokens ficam em [`src/ui/tokens.css`](../src/ui/tokens.css) (todos com prefixo `--pb-`, porque o arquivo também é injetado no jogo, que já usa nomes como `--ink` e `--gold`). Os componentes `.pr-*` ficam em [`src/ui/retro.css`](../src/ui/retro.css).

## Princípios

1. **Pixel honesto.** Nada de desfoque, gradiente suave ou canto arredondado. Bordas de 2 px ou 4 px, cantos chanfrados, sombras duras deslocadas.
2. **Vermelho é a carcaça.** `--pb-dex-red` só na barra de título e no botão principal. Texto vermelho usa `--pb-dex-red-ink`.
3. **Amarelo é recompensa.** `--pb-pika-yellow` só para "Resgatar", preenchimento de barras de progresso e item ativo no tema noite.
4. **Cor de tipo é dado.** `--pb-type-*` só em chips, no chão do sprite e na faixa do card.
5. **O sprite é o herói.** Sempre `image-rendering: pixelated`, ampliado em escala inteira (2×, 3×…). Maior que a área: reduzir para caber.

Temas: **noite** (padrão) e **dia** (`data-theme="dia"`). Todo texto passa de 4,5:1 nos dois; não troque cores sem recalcular o contraste.

## Cores

| Token | Noite | Dia | Uso |
|---|---|---|---|
| `--pb-screen` | `#12161E` | `#E9E5CC` | Fundo da página e da "tela" |
| `--pb-surface` | `#1C2230` | `#F7F4E4` | Corpo de painéis e cards |
| `--pb-surface-raised` | `#283044` | `#DDD8BC` | Hover, selecionado, áreas elevadas |
| `--pb-border` | `#66769A` | `#191920` | Moldura de pixel de controles e cards |
| `--pb-shadow-ink` | `#05070A` | `#191920` | Sombra dura e contorno |
| `--pb-ink` | `#F4F0E2` | `#191920` | Texto principal |
| `--pb-ink-muted` | `#A9B1C2` | `#4C5260` | Rótulos e números secundários |
| `--pb-dex-red` | `#D62B25` | `#C81E1E` | Carcaça: barra de título e botão principal |
| `--pb-dex-red-deep` | `#8A1117` | `#7A0E12` | Faixa inferior da barra, botão pressionado |
| `--pb-dex-red-ink` | `#FF7A6E` | `#A81616` | Vermelho para texto (erro, alerta) |
| `--pb-pika-yellow` | `#FFCB05` | `#FFCB05` | Recompensa, barras, ativo (noite) |
| `--pb-poke-blue` | `#7FA6F5` | `#2C58B0` | Informação, links, lente |
| `--pb-success` | `#62C96F` | `#22662D` | Capturado, sucesso |

As 18 cores de tipo (`--pb-type-normal` … `--pb-type-fairy`) são iguais nos dois temas. Texto do chip: escuro, menos Lutador, Venenoso, Fantasma, Dragão e Sombrio (branco).

## Tipografia

| Estilo | Fonte | Tamanho / linha / peso | Uso |
|---|---|---|---|
| display-lg | Press Start 2P | 24 / 32 / 400 | Título de tela cheia |
| display | Press Start 2P | 16 / 24 / 400 | Título de painel, contadores |
| display-tag | Press Start 2P | 8 / 12 / 400 | Nº da Pokédex, etiquetas curtas |
| title | Pixelify Sans | 20 / 24 / 600 | Cabeçalho de seção |
| body | Pixelify Sans | 16 / 22 / 400–600 | Texto, botões, nomes |
| small | Pixelify Sans | 14 / 18 / 500 | Metadados |
| micro | Pixelify Sans | 12 / 16 / 500 | Rótulos, chips, contagens |

Press Start 2P só em 8, 16 ou 24 px e em textos curtos. Fontes do Google Fonts (licença OFL).

## Forma

- Espaçamento em passos de 4 px (`--pb-space-1` … `--pb-space-6`).
- Sem cantos arredondados; `--pb-radius-ball` (50%) só na lente e na Poké Ball; `--pb-radius-dot` (2 px) só nos LEDs.
- **Moldura de pixel** = quatro `box-shadow` em vez de `border` (cantos chanfrados): `--pb-frame-border`, `--pb-frame-ink`, `--pb-frame-focus`.
- Sombras: `--pb-shadow-hard` (4 px), `--pb-shadow-press` (2 px, botão pressionado), `--pb-shadow-bevel` (relevo de telas e campos).

## Componentes

- **Panel:** barra `dex-red` com faixa inferior de 4 px `dex-red-deep`, lente azul com anel branco, LEDs, título em display; corpo em `screen` com relevo.
- **Button** (`.pr-btn`, `--secondary`, `--ghost`, `--icon`): moldura escura + sombra dura; pressionado desce 2 px.
- **TypeChip:** 12 px/600, moldura escura, cor do tipo.
- **PixelBar:** trilho escuro com moldura, preenchimento em segmentos (`repeating-linear-gradient` de 6 px + 2 px); amarelo, verde quando completa. Sempre com o número em texto.
- **Tally:** número em display, legenda em micro; o ativo ganha moldura amarela.
- **Field:** rótulo visível, moldura + relevo, anel de foco de 2 px.

Ícones são glifos simples (✓ capturado, ✦ shiny, ! recompensa, × fechar, ▾ seletor, → evolui para). Sem emoji na interface. Textos em português, curtos e diretos; botões são verbos.
