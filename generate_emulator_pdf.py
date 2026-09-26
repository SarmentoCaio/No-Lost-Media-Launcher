#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import Flowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# ─── CORES ───────────────────────────────────────────────────────────────────
BG_DARK      = HexColor("#080b12")
ACCENT_BLUE  = HexColor("#3b82f6")
ACCENT_LIGHT = HexColor("#60a5fa")
MUTED_BLUE   = HexColor("#1e3a5f")
MUTED_SLATE  = HexColor("#1a2236")
TEXT_PRIMARY = HexColor("#e2e8f0")
TEXT_MUTED   = HexColor("#94a3b8")
SUCCESS      = HexColor("#22c55e")
WARNING      = HexColor("#f59e0b")
CODE_BG      = HexColor("#0f172a")
BORDER       = HexColor("#1e3a5f")
WHITE        = HexColor("#ffffff")
STEP_BG      = HexColor("#0f1e35")

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "No_Lost_Media_Launcher_Emuladores.pdf")

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2.5*cm, bottomMargin=2.5*cm,
    title="Documentação – Download de Emuladores | No Lost Media Launcher",
    author="No Lost Media",
    subject="Arquitetura e funcionamento do sistema de download de emuladores",
)

W = A4[0] - 4*cm  # Largura útil

# ─── ESTILOS ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def style(name, **kw):
    return ParagraphStyle(name, **{
        "fontName": "Helvetica",
        "textColor": TEXT_PRIMARY,
        "backColor": None,
        **kw
    })

S_TITLE     = style("Title",    fontSize=26, leading=32, textColor=WHITE,
                    spaceAfter=6, spaceBefore=0, alignment=TA_CENTER, fontName="Helvetica-Bold")
S_SUBTITLE  = style("Sub",      fontSize=12, leading=18, textColor=ACCENT_LIGHT,
                    spaceAfter=12, alignment=TA_CENTER)
S_H1        = style("H1",       fontSize=15, leading=20, textColor=WHITE,
                    spaceBefore=18, spaceAfter=6, fontName="Helvetica-Bold")
S_H2        = style("H2",       fontSize=11, leading=16, textColor=ACCENT_LIGHT,
                    spaceBefore=12, spaceAfter=4, fontName="Helvetica-Bold")
S_BODY      = style("Body",     fontSize=9.5, leading=15, textColor=TEXT_PRIMARY,
                    spaceAfter=6, alignment=TA_JUSTIFY)
S_MUTED     = style("Muted",    fontSize=8.5, leading=13, textColor=TEXT_MUTED, spaceAfter=4)
S_CODE      = style("Code",     fontSize=8.5, leading=13, textColor=HexColor("#7dd3fc"),
                    backColor=CODE_BG, fontName="Courier", spaceAfter=4, leftIndent=8, rightIndent=8)
S_BULLET    = style("Bullet",   fontSize=9.5, leading=14, textColor=TEXT_PRIMARY,
                    leftIndent=14, spaceAfter=3)
S_STEP_N    = style("StepN",    fontSize=20, leading=24, textColor=ACCENT_BLUE,
                    fontName="Helvetica-Bold", alignment=TA_CENTER)
S_STEP_TIT  = style("StepT",    fontSize=11, leading=14, textColor=WHITE,
                    fontName="Helvetica-Bold")
S_STEP_BODY = style("StepB",    fontSize=9, leading=13, textColor=TEXT_MUTED)
S_TABLE_H   = style("TH",       fontSize=9, leading=12, textColor=WHITE,
                    fontName="Helvetica-Bold", alignment=TA_CENTER)
S_TABLE_C   = style("TC",       fontSize=9, leading=12, textColor=TEXT_PRIMARY, alignment=TA_CENTER)
S_TABLE_CL  = style("TCL",      fontSize=9, leading=12, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S_CAPTION   = style("Cap",      fontSize=8, leading=11, textColor=TEXT_MUTED,
                    alignment=TA_CENTER, spaceAfter=8)

# ─── FLOWABLE: BANNER DO CABEÇALHO ──────────────────────────────────────────
class HeaderBanner(Flowable):
    def __init__(self, width, height=110):
        super().__init__()
        self.width  = width
        self.height = height

    def draw(self):
        c = self.canv
        # Fundo
        c.setFillColor(MUTED_SLATE)
        c.roundRect(0, 0, self.width, self.height, 8, fill=1, stroke=0)
        # Borda accent
        c.setStrokeColor(ACCENT_BLUE)
        c.setLineWidth(1.5)
        c.roundRect(0, 0, self.width, self.height, 8, fill=0, stroke=1)
        # Linha decorativa superior
        c.setFillColor(ACCENT_BLUE)
        c.roundRect(0, self.height-4, self.width, 4, 2, fill=1, stroke=0)

class SectionDivider(Flowable):
    def __init__(self, width):
        super().__init__()
        self.width  = width
        self.height = 2

    def draw(self):
        c = self.canv
        c.setFillColor(ACCENT_BLUE)
        c.rect(0, 0, self.width, 2, fill=1, stroke=0)

class StepBox(Flowable):
    def __init__(self, number, title, body, width):
        super().__init__()
        self.number = number
        self.title  = title
        self.body   = body
        self.width  = width
        self.height = 72

    def draw(self):
        c = self.canv
        c.setFillColor(STEP_BG)
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=0)
        c.setStrokeColor(ACCENT_BLUE)
        c.setLineWidth(1)
        c.roundRect(0, 0, self.width, self.height, 6, fill=0, stroke=1)
        # Número
        c.setFillColor(ACCENT_BLUE)
        c.roundRect(0, 0, 52, self.height, 6, fill=1, stroke=0)
        c.rect(40, 0, 12, self.height, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(26, self.height/2 - 8, str(self.number))
        # Título
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(62, self.height - 22, self.title)
        # Corpo
        c.setFillColor(TEXT_MUTED)
        c.setFont("Helvetica", 8.5)
        lines = self._wrap(self.body, self.width - 70)
        y = self.height - 37
        for line in lines[:3]:
            c.drawString(62, y, line)
            y -= 13

    def _wrap(self, text, max_width):
        words = text.split()
        lines, current = [], ""
        c = self.canv
        c.setFont("Helvetica", 8.5)
        for word in words:
            test = (current + " " + word).strip()
            if c.stringWidth(test, "Helvetica", 8.5) < max_width:
                current = test
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def bullet(text, color=ACCENT_BLUE):
    marker = f'<font color="#{color.hexval()[2:]}">▸</font>'
    return Paragraph(f"{marker}  {text}", S_BULLET)

def section_header(text):
    return [
        SectionDivider(W),
        Spacer(1, 6),
        Paragraph(text, S_H1),
        Spacer(1, 4),
    ]

def background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG_DARK)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    # Rodapé
    canvas.setFillColor(TEXT_MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(A4[0]/2, 1.2*cm,
        "No Lost Media Launcher — Documentação Técnica de Emuladores — v0.1.2")
    canvas.restoreState()

# ─── CONTEÚDO ────────────────────────────────────────────────────────────────
story = []

# CAPA
story.append(Spacer(1, 0.8*cm))
story.append(HeaderBanner(W))
story.append(Spacer(1, -98))  # sobreposição visual
story.append(Paragraph("No Lost Media Launcher", S_TITLE))
story.append(Paragraph("Documentação Técnica — Sistema de Download de Emuladores", S_SUBTITLE))
story.append(Spacer(1, 30))

story.append(Paragraph(
    "Este documento descreve em detalhes a arquitetura e o funcionamento do sistema de download, "
    "validação, extração e configuração automática de emuladores dentro do No Lost Media Launcher. "
    "O processo é inteiramente gerenciado pelo backend nativo em Rust, garantindo segurança "
    "criptográfica, downloads resumíveis e instalação em modo portátil.",
    S_BODY
))
story.append(Spacer(1, 0.4*cm))

# ─── 1. EMULADORES GERENCIADOS ───────────────────────────────────────────────
story += section_header("1. Emuladores Gerenciados")
story.append(Paragraph(
    "O launcher distingue dois tipos de emuladores: os com instalação automática com 1 clique "
    "(gerenciados) e os que requerem configuração manual (detectados). A tabela abaixo resume "
    "todos os emuladores suportados:",
    S_BODY
))
story.append(Spacer(1, 0.3*cm))

table_data = [
    [Paragraph("Emulador", S_TABLE_H),
     Paragraph("Consoles Atendidos", S_TABLE_H),
     Paragraph("Tipo de Instalação", S_TABLE_H),
     Paragraph("Fonte Oficial", S_TABLE_H)],
    [Paragraph("PCSX2", S_TABLE_C),
     Paragraph("PlayStation 2", S_TABLE_C),
     Paragraph("✅ Automática", S_TABLE_C),
     Paragraph("GitHub — PCSX2/pcsx2", S_TABLE_CL)],
    [Paragraph("DuckStation", S_TABLE_C),
     Paragraph("PlayStation 1", S_TABLE_C),
     Paragraph("✅ Automática", S_TABLE_C),
     Paragraph("GitHub — stenzek/duckstation", S_TABLE_CL)],
    [Paragraph("Dolphin", S_TABLE_C),
     Paragraph("GameCube & Wii", S_TABLE_C),
     Paragraph("✅ Automática", S_TABLE_C),
     Paragraph("dl.dolphin-emu.org", S_TABLE_CL)],
    [Paragraph("RetroArch", S_TABLE_C),
     Paragraph("SNES, NES, GBA, N64, Dreamcast", S_TABLE_C),
     Paragraph("✅ Automática + Núcleos", S_TABLE_C),
     Paragraph("buildbot.libretro.com", S_TABLE_CL)],
    [Paragraph("RPCS3", S_TABLE_C),
     Paragraph("PlayStation 3", S_TABLE_C),
     Paragraph("⚙️ Manual / Detectado", S_TABLE_C),
     Paragraph("rpcs3.net (usuário instala)", S_TABLE_CL)],
    [Paragraph("—", S_TABLE_C),
     Paragraph("Jogos de PC", S_TABLE_C),
     Paragraph("🖥️ Nativo", S_TABLE_C),
     Paragraph("Sem emulador (execução direta)", S_TABLE_CL)],
]

col_w = [2.8*cm, 3.8*cm, 3.4*cm, 5.4*cm]
tbl = Table(table_data, colWidths=col_w, repeatRows=1)
tbl.setStyle(TableStyle([
    ("BACKGROUND",   (0,0), (-1,0),  MUTED_BLUE),
    ("BACKGROUND",   (0,1), (-1,1),  MUTED_SLATE),
    ("BACKGROUND",   (0,2), (-1,2),  CODE_BG),
    ("BACKGROUND",   (0,3), (-1,3),  MUTED_SLATE),
    ("BACKGROUND",   (0,4), (-1,4),  CODE_BG),
    ("BACKGROUND",   (0,5), (-1,5),  MUTED_SLATE),
    ("BACKGROUND",   (0,6), (-1,6),  CODE_BG),
    ("ROWBACKGROUNDS",(0,0),(-1,-1), [MUTED_BLUE, MUTED_SLATE, CODE_BG]),
    ("GRID",         (0,0), (-1,-1), 0.5, BORDER),
    ("ROUNDEDCORNERS", [4]),
    ("TOPPADDING",   (0,0), (-1,-1), 6),
    ("BOTTOMPADDING",(0,0), (-1,-1), 6),
    ("LEFTPADDING",  (0,0), (-1,-1), 8),
    ("RIGHTPADDING", (0,0), (-1,-1), 8),
]))
story.append(tbl)
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph(
    "Tamanhos de download: PCSX2 ≈ 24,5 MB · DuckStation ≈ 69,3 MB · Dolphin ≈ 19,1 MB · RetroArch ≈ 412 MB",
    S_CAPTION
))

# ─── 2. CICLO DE INSTALAÇÃO ──────────────────────────────────────────────────
story += section_header("2. Ciclo de Instalação — Passo a Passo")
story.append(Paragraph(
    "Quando o usuário clica em 'Instalar Emulador', o frontend React (App.tsx) dispara o "
    "comando nativo Tauri <font name='Courier'>install_emulator</font>, que executa em background "
    "o módulo Rust <font name='Courier'>managed_emulators.rs</font>. O fluxo completo é:",
    S_BODY
))
story.append(Spacer(1, 0.3*cm))

steps = [
    ("1", "Disparo e IPC em Tempo Real",
     "O frontend chama install_emulator via Tauri IPC. Um canal Channel<EmulatorInstallEvent> emite "
     "eventos contínuos: porcentagem, velocidade (MB/s), ETA, bytes baixados e estado atual."),
    ("2", "Verificação de Espaço em Disco",
     "Antes do download, ensure_disk_space() calcula: espaço = tamanho_pacote + tamanho_descompactado + 256 MB. "
     "Se insuficiente, a instalação é abortada imediatamente."),
    ("3", "Download Resumível com Cache Local",
     "O arquivo é gravado em [Biblioteca]/cache/emulators/[id]/[versao]/[arquivo].part com suporte a "
     "Range HTTP. Se o usuário pausar e retomar, o download continua do byte exato onde parou."),
    ("4", "Validação Criptográfica SHA-256",
     "Após o download, o hash SHA-256 do arquivo é calculado e comparado com o valor auditado "
     "hard-coded no launcher. Qualquer divergência descarta o arquivo para proteger o usuário."),
    ("5", "Extração em Pasta de Staging Isolada",
     "A extração ocorre numa pasta oculta temporária (.[id]-installing-[versao]), usando "
     "sevenz_rust (7z) ou zip::ZipArchive. Uma instalação existente nunca é afetada."),
    ("6", "Ativação do Modo Portátil",
     "Para evitar poluição do sistema (AppData, Registro), o launcher cria o arquivo de modo "
     "portátil: portable.ini (PCSX2), portable.txt (DuckStation/Dolphin) ou NoLostMedia.cfg (RetroArch)."),
    ("7", "Troca Atômica e Registro Final",
     "A pasta de staging é renomeada atomicamente para [Biblioteca]/emulators/[id]. O caminho "
     "do executável e a versão instalada são salvos no config.json. O backup anterior é removido."),
]

for num, title, body in steps:
    story.append(StepBox(int(num), title, body, W))
    story.append(Spacer(1, 0.3*cm))

# ─── 3. CASO ESPECIAL RETROARCH ──────────────────────────────────────────────
story += section_header("3. Caso Especial: RetroArch e Núcleos de Consoles")
story.append(Paragraph(
    "O RetroArch requer dois pacotes distintos que são baixados e validados sequencialmente:",
    S_BODY
))

ra_data = [
    [Paragraph("Pacote", S_TABLE_H),
     Paragraph("Tamanho Esperado", S_TABLE_H),
     Paragraph("Hash SHA-256 (primeiros 16 chars)", S_TABLE_H),
     Paragraph("Conteúdo", S_TABLE_H)],
    [Paragraph("RetroArch.7z", S_TABLE_CL),
     Paragraph("202,5 MB", S_TABLE_C),
     Paragraph("b2139b1d0f9d4526...", S_TABLE_C),
     Paragraph("Executável principal e interface Ozone", S_TABLE_CL)],
    [Paragraph("RetroArch_cores.7z", S_TABLE_CL),
     Paragraph("229,8 MB", S_TABLE_C),
     Paragraph("86b871e11b9b4772...", S_TABLE_C),
     Paragraph("Todos os núcleos de consoles (.dll)", S_TABLE_CL)],
]

ra_col_w = [3.5*cm, 2.8*cm, 4.0*cm, 5.1*cm]
ra_tbl = Table(ra_data, colWidths=ra_col_w, repeatRows=1)
ra_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0),  MUTED_BLUE),
    ("BACKGROUND", (0,1), (-1,1),  MUTED_SLATE),
    ("BACKGROUND", (0,2), (-1,2),  CODE_BG),
    ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING",(0,0),(-1,-1),6),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING",(0,0), (-1,-1), 8),
]))
story.append(ra_tbl)
story.append(Spacer(1, 0.3*cm))

story.append(Paragraph("Após a extração, o launcher verifica a presença obrigatória de:", S_BODY))
cores = [
    ("snes9x_libretro.dll",            "Super Nintendo Entertainment System (SNES)"),
    ("mesen_libretro.dll",             "Nintendo Entertainment System (NES)"),
    ("mgba_libretro.dll",              "Game Boy Advance (GBA)"),
    ("mupen64plus_next_libretro.dll",  "Nintendo 64 (N64)"),
    ("flycast_libretro.dll",           "Sega Dreamcast"),
]
for dll, console in cores:
    story.append(Paragraph(
        f'<font name="Courier" color="#7dd3fc">{dll}</font>  '
        f'<font color="#94a3b8">→ {console}</font>',
        S_BULLET
    ))

story.append(Spacer(1, 0.3*cm))
story.append(Paragraph(
    "Além dos núcleos, o arquivo <font name='Courier'>NoLostMedia.cfg</font> é gerado "
    "automaticamente, configurando os diretórios de saves e states para "
    "<font name='Courier'>[Biblioteca]/saves/retroarch</font> e ativando auto-save/load de estados.",
    S_BODY
))

# ─── 4. CANCELAMENTO E GERENCIAMENTO ─────────────────────────────────────────
story += section_header("4. Cancelamento e Gerenciamento de Downloads")
story.append(Paragraph(
    "O usuário pode interagir com downloads ativos a qualquer momento. O sistema usa o controle "
    "<font name='Courier'>DownloadCancellation</font> baseado em flags atômicas para comunicação "
    "entre as threads do backend Rust e o frontend React:",
    S_BODY
))
story.append(Spacer(1, 0.2*cm))

cancel_data = [
    [Paragraph("Ação", S_TABLE_H),
     Paragraph("Comportamento no Backend", S_TABLE_H),
     Paragraph("Resultado para o Usuário", S_TABLE_H)],
    [Paragraph("⏸ Pausar", S_TABLE_C),
     Paragraph("cancel(discard=false) — arquivo .part preservado no disco", S_TABLE_CL),
     Paragraph("Barra de progresso fica em estado 'Pausado'. Pode retomar depois.", S_TABLE_CL)],
    [Paragraph("❌ Cancelar e Excluir", S_TABLE_C),
     Paragraph("cancel(discard=true) — apaga cache/[id]/[versao] e .staging", S_TABLE_CL),
     Paragraph("Todos os arquivos temporários são removidos. Libera espaço imediatamente.", S_TABLE_CL)],
    [Paragraph("🔁 Retomada", S_TABLE_C),
     Paragraph("Range HTTP bytes={downloaded}- retoma da posição exata", S_TABLE_CL),
     Paragraph("Download continua automaticamente sem recomeçar do zero.", S_TABLE_CL)],
]

cancel_col_w = [2.4*cm, 6.5*cm, 6.5*cm]
c_tbl = Table(cancel_data, colWidths=cancel_col_w, repeatRows=1)
c_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0),  MUTED_BLUE),
    ("BACKGROUND", (0,1), (-1,1),  MUTED_SLATE),
    ("BACKGROUND", (0,2), (-1,2),  CODE_BG),
    ("BACKGROUND", (0,3), (-1,3),  MUTED_SLATE),
    ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING",(0,0),(-1,-1),6),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING",(0,0), (-1,-1), 8),
    ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
]))
story.append(c_tbl)

# ─── 5. ESTRUTURA DE PASTAS ──────────────────────────────────────────────────
story += section_header("5. Estrutura de Pastas na Biblioteca do Usuário")
story.append(Paragraph(
    "Toda a instalação e os dados gerados pelo launcher ficam confinados dentro da "
    "pasta de Biblioteca escolhida pelo usuário, sem nenhuma escrita fora dela "
    "(exceto o config.json interno do Tauri):",
    S_BODY
))
story.append(Spacer(1, 0.2*cm))

tree_lines = [
    ("[Biblioteca]/",                           "Raiz da biblioteca"),
    ("├── emulators/",                          "Emuladores instalados"),
    ("│   ├── pcsx2/",                          "PCSX2 em modo portátil"),
    ("│   ├── duckstation/",                    "DuckStation em modo portátil"),
    ("│   ├── dolphin/",                        "Dolphin em modo portátil"),
    ("│   └── retroarch/",                      "RetroArch + núcleos (.dll)"),
    ("├── games/",                              "Jogos instalados por sistema"),
    ("│   ├── ps2/",                            "Jogos extraídos de PS2"),
    ("│   └── ps1/",                            "Jogos extraídos de PS1"),
    ("├── saves/",                              "Saves e estados de jogo"),
    ("│   └── retroarch/",                      "Saves do RetroArch"),
    ("└── cache/",                              "Arquivos temporários de download"),
    ("    └── emulators/",                      "Cache dos instaladores"),
    ("        └── [id]/[versao]/",              "Pacote .7z/.zip baixado e validado"),
]

tree_data = [[
    Paragraph(f'<font name="Courier" color="#7dd3fc">{path}</font>', S_TABLE_CL),
    Paragraph(desc, S_TABLE_CL),
] for path, desc in tree_lines]

tree_tbl = Table(tree_data, colWidths=[8.5*cm, 7.0*cm])
tree_tbl.setStyle(TableStyle([
    ("BACKGROUND",    (0,0), (-1,-1), CODE_BG),
    ("GRID",          (0,0), (-1,-1), 0, CODE_BG),
    ("LINEAFTER",     (0,0), (0,-1),  0.5, BORDER),
    ("TOPPADDING",    (0,0), (-1,-1), 3),
    ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ("LEFTPADDING",   (0,0), (-1,-1), 10),
    ("RIGHTPADDING",  (0,0), (-1,-1), 8),
    ("ROUNDEDCORNERS", [4]),
]))
story.append(tree_tbl)
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph(
    "Os arquivos em cache são mantidos após a instalação para evitar re-downloads. "
    "Após cancelamento com exclusão, os arquivos de cache do emulador são removidos automaticamente.",
    S_MUTED
))

# ─── 6. SEGURANÇA ────────────────────────────────────────────────────────────
story += section_header("6. Segurança e Garantias do Sistema")

security_items = [
    ("SHA-256 auditado no código-fonte",
     "Cada versão gerenciada possui um hash criptográfico fixo embutido diretamente no "
     "código Rust. Qualquer pacote corrompido, adulterado ou substituído é rejeitado "
     "antes mesmo de ser extraído."),
    ("Validação de tamanho antes do download",
     "O Content-Length retornado pelo servidor é verificado contra o tamanho esperado. "
     "Um servidor comprometido servindo um pacote de tamanho diferente é bloqueado imediatamente."),
    ("Verificação de caminhos seguros na extração",
     "Todos os caminhos extraídos de arquivos ZIP e 7z passam por validação de caminho "
     "enclosed_name(), prevenindo ataques de Path Traversal (Zip Slip)."),
    ("Instalação exclusivamente por HTTPS",
     "Todos os downloads de emuladores e de jogos utilizam exclusivamente HTTPS. "
     "O launcher rejeita URLs com outros esquemas."),
    ("Modo portátil forçado",
     "Os emuladores gerenciados são configurados em modo portátil, garantindo que saves "
     "e configurações fiquem dentro da pasta de Biblioteca do usuário, sem alterar o "
     "registro do Windows, AppData ou pastas do sistema."),
    ("Atomicidade das trocas",
     "A ativação de uma nova versão do emulador usa rename() atômico do sistema de arquivos, "
     "garantindo que nunca há um estado parcialmente instalado caso o processo seja interrompido."),
]

for i, (title, body) in enumerate(security_items):
    story.append(KeepTogether([
        Paragraph(f'<font color="#22c55e">🛡</font>  <b>{title}</b>', S_H2),
        Paragraph(body, S_BODY),
    ]))

# ─── 7. ARQUIVOS RELEVANTES ──────────────────────────────────────────────────
story += section_header("7. Arquivos de Código-Fonte Relevantes")

files_data = [
    [Paragraph("Arquivo", S_TABLE_H),
     Paragraph("Responsabilidade", S_TABLE_H)],
    [Paragraph("src-tauri/src/managed_emulators.rs", S_TABLE_CL),
     Paragraph("Toda a lógica de download, validação SHA-256, extração e instalação portátil de emuladores.", S_TABLE_CL)],
    [Paragraph("src-tauri/src/lib.rs", S_TABLE_CL),
     Paragraph("Comandos Tauri (install_emulator, cancel_download, import_bios), detecção de emuladores instalados e registro no config.json.", S_TABLE_CL)],
    [Paragraph("src/App.tsx", S_TABLE_CL),
     Paragraph("Lógica de UI para download de emuladores: estados, progresso em tempo real, pause/resume, retentativas com backoff.", S_TABLE_CL)],
    [Paragraph("src/runtime/tauriDesktopRuntime.ts", S_TABLE_CL),
     Paragraph("Ponte entre o frontend TypeScript e os comandos nativos Tauri (installEmulator, cancelDownload).", S_TABLE_CL)],
]

files_col_w = [6.5*cm, 9.0*cm]
f_tbl = Table(files_data, colWidths=files_col_w, repeatRows=1)
f_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), MUTED_BLUE),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [MUTED_SLATE, CODE_BG]),
    ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
    ("TOPPADDING", (0,0), (-1,-1), 7),
    ("BOTTOMPADDING",(0,0),(-1,-1), 7),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING",(0,0), (-1,-1), 8),
    ("VALIGN",     (0,0), (-1,-1), "TOP"),
]))
story.append(f_tbl)
story.append(Spacer(1, 0.5*cm))

story.append(HRFlowable(width=W, thickness=0.5, color=BORDER))
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph(
    "Documento gerado automaticamente • No Lost Media Launcher v0.1.2 • Sistema de Emuladores Gerenciados",
    S_CAPTION
))

# ─── RENDER ──────────────────────────────────────────────────────────────────
doc.build(story, onFirstPage=background, onLaterPages=background)
print(f"PDF gerado: {OUTPUT_PATH}")
