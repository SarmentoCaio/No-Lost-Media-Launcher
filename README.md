# No Lost Media Launcher

Site oficial do acervo: https://nolost.media/

Interface unificada para descobrir, instalar, organizar e executar jogos com o emulador adequado, sem exigir que o usuário navegue por pastas.

## Estrutura

- `apps/launcher`: aplicativo React responsivo e shell Tauri para desktop.
- `packages/core`: contratos e regras independentes de React, navegador ou sistema operacional.
- `docs/ARCHITECTURE.md`: decisões para evolução desktop e mobile.

## Desenvolvimento da interface

```bash
npm install
npm run dev
```

O modo navegador usa um adaptador de demonstração persistido em `localStorage`. Ele permite validar busca, filtros, biblioteca e fluxo de instalação sem executar programas locais.

## Aplicativo desktop

O shell Tauri fica em `apps/launcher/src-tauri`. A primeira integração nativa já permite:

- criar uma biblioteca padrão privada em `AppData` no primeiro uso, sem exigir configuração manual;
- permitir a troca da pasta principal da biblioteca;
- criar automaticamente as pastas de jogos, saves, BIOS, cache e emuladores;
- baixar PCSX2, DuckStation, Dolphin e RetroArch diretamente das fontes oficiais, com progresso, retomada e verificação SHA-256;
- configurar automaticamente saves e o núcleo correto para NES, SNES, GBA, Nintendo 64 e Dreamcast;
- detectar emuladores em locais conhecidos ou selecionar o executável manualmente;
- vincular um arquivo local ao jogo do catálogo;
- iniciar PCSX2, DuckStation, Dolphin e RetroArch sem montar comandos de shell;
- manter configurações e biblioteca no diretório de dados do aplicativo.
- consultar o catálogo integrado do No Lost Media e baixar jogos autorizados diretamente do acervo;
- retomar downloads, conferir SHA-1 quando disponível e preparar automaticamente ZIP/7Z para o emulador.

```bash
npm run tauri -- dev
```

Para gerar o executável de desenvolvimento:

```bash
npm run tauri -- build --debug --no-bundle
```

Também é possível selecionar uma instalação existente pela opção avançada. BIOS proprietárias não são distribuídas: nos sistemas que exigem BIOS, o usuário deve fornecer o arquivo extraído do próprio console.

## Catálogo No Lost Media

O aplicativo já leva um snapshot do acervo compatível com os emuladores atuais. Para atualizá-lo a partir do projeto principal localizado ao lado deste repositório:

```bash
npm run catalog:sync
```

Também é possível definir `VITE_CATALOG_ENDPOINT` com um endpoint JSON compatível. Se a atualização online falhar, o launcher usa automaticamente o snapshot incluído.

```bash
VITE_CATALOG_ENDPOINT=https://catalogo.exemplo/api/games
```

BIOS proprietárias não fazem parte do launcher. O usuário deve possuir autorização para baixar e utilizar os arquivos do acervo. Itens publicados somente em RAR permanecem visíveis, mas por enquanto exigem um arquivo local em outro formato compatível.
