# Arquitetura e expansão

## Decisão principal

O launcher é dividido entre domínio, interface e integração nativa. Nenhuma regra de catálogo, biblioteca ou escolha de emulador deve depender diretamente do Tauri.

```text
apps/launcher (React)
        |
        v
packages/core (modelos + portas)
        |
        +-- BrowserPreviewRuntime
        +-- TauriDesktopRuntime
        +-- MobileRuntime (futuro)
```

Essa separação permite criar um aplicativo Android/iOS reutilizando o domínio e boa parte da interface. Recursos que mudam por sistema operacional ficam atrás de `PlatformRuntime`.

## Desktop

No Windows, o runtime poderá:

1. Detectar ou instalar emuladores permitidos.
2. Escolher uma pasta de biblioteca.
3. Baixar arquivos com retomada e verificação de hash.
4. Extrair arquivos para uma área controlada.
5. Registrar o jogo instalado em banco local.
6. Iniciar somente executáveis previamente cadastrados, sem aceitar comandos arbitrários do catálogo.

O primeiro conjunto sugerido é PCSX2, DuckStation, Dolphin e RetroArch.

## Mobile

Android e iOS não podem reutilizar executáveis de Windows. O aplicativo móvel usará o mesmo catálogo e biblioteca, mas terá outro adaptador:

- deep links para emuladores instalados quando permitido;
- núcleos nativos/libretro apenas quando licença e políticas da loja permitirem;
- sincronização opcional de favoritos, biblioteca e saves;
- downloads respeitando armazenamento, bateria e execução em segundo plano.

Não se deve prometer suporte a um console no mobile apenas porque ele existe no desktop. `RuntimeCapabilities` informa à interface o que cada dispositivo realmente suporta.

## Evolução recomendada

1. Interface, catálogo e biblioteca local. **Base concluída.**
2. Seleção da pasta principal e importação de jogos locais. **Base concluída.**
3. Registro e inicialização segura de emuladores. **Base concluída.**
4. Download, extração, integridade e retomada. **Próxima etapa.**
5. Controles e configurações por console.
6. Atualizador assinado do launcher e manifesto assinado dos emuladores.
7. Aplicativo móvel consumindo os pacotes compartilhados.

## Segurança e distribuição

- Emuladores devem ter versão, licença, origem e SHA-256 registrados.
- BIOS proprietárias não devem ser distribuídas.
- URLs do catálogo nunca podem virar argumentos de shell diretamente.
- Downloads devem ser gravados primeiro como temporários e promovidos somente após validação.
- Atualizações do aplicativo devem ser assinadas.
