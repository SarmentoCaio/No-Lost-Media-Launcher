#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, PageBreak
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus import Flowable
import os

# ─── PALETA DE CORES ───────────────────────────────────────────────────────────
BG_DARK      = HexColor("#080b12")
ACCENT_BLUE  = HexColor("#3b82f6")
ACCENT_LIGHT = HexColor("#60a5fa")
ACCENT_CYAN  = HexColor("#38bdf8")
MUTED_BLUE   = HexColor("#1e3a5f")
MUTED_SLATE  = HexColor("#1a2236")
TEXT_PRIMARY = HexColor("#e2e8f0")
TEXT_MUTED   = HexColor("#94a3b8")
SUCCESS      = HexColor("#22c55e")
WARNING      = HexColor("#f59e0b")
DANGER       = HexColor("#ef4444")
CODE_BG      = HexColor("#0f172a")
BORDER       = HexColor("#1e3a5f")
WHITE        = HexColor("#ffffff")
STEP_BG      = HexColor("#0f1e35")

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "No_Lost_Media_Launcher_Repositorio_Privado_e_AutoUpdate.pdf")

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=1.8*cm, rightMargin=1.8*cm,
    topMargin=1.8*cm, bottomMargin=1.8*cm,
    title="Transição para Repositório Privado e Impacto no Auto-Update",
    author="No Lost Media",
    subject="Análise técnica de impactos, riscos e soluções para auto-update em repositórios privados",
)

W = A4[0] - 3.6*cm  # Largura útil (17.4 cm)

# ─── ESTILOS ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def style(name, **kw):
    return ParagraphStyle(name, **{
        "fontName": "Helvetica",
        "textColor": TEXT_PRIMARY,
        "backColor": None,
        **kw
    })

S_TITLE     = style("Title",    fontSize=20, leading=25, textColor=WHITE,
                    spaceAfter=3, spaceBefore=0, alignment=TA_CENTER, fontName="Helvetica-Bold")
S_SUBTITLE  = style("Sub",      fontSize=10, leading=14, textColor=ACCENT_LIGHT,
                    spaceAfter=8, alignment=TA_CENTER)
S_H1        = style("H1",       fontSize=12, leading=16, textColor=WHITE,
                    spaceBefore=10, spaceAfter=4, fontName="Helvetica-Bold")
S_H2        = style("H2",       fontSize=9.5, leading=13.5, textColor=ACCENT_LIGHT,
                    spaceBefore=7, spaceAfter=2, fontName="Helvetica-Bold")
S_BODY      = style("Body",     fontSize=8.5, leading=13, textColor=TEXT_PRIMARY,
                    spaceAfter=4, alignment=TA_JUSTIFY)
S_MUTED     = style("Muted",    fontSize=7.5, leading=11, textColor=TEXT_MUTED, spaceAfter=2)
S_CODE      = style("Code",     fontSize=7.5, leading=11, textColor=HexColor("#7dd3fc"),
                    backColor=CODE_BG, fontName="Courier", spaceAfter=2, leftIndent=4, rightIndent=4)
S_BULLET    = style("Bullet",   fontSize=8.5, leading=12.5, textColor=TEXT_PRIMARY,
                    leftIndent=10, spaceAfter=2.5)
S_TABLE_H   = style("TH",       fontSize=8, leading=10, textColor=WHITE,
                    fontName="Helvetica-Bold", alignment=TA_CENTER)
S_TABLE_C   = style("TC",       fontSize=7.5, leading=10, textColor=TEXT_PRIMARY, alignment=TA_CENTER)
S_TABLE_CL  = style("TCL",      fontSize=7.5, leading=10, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S_CAPTION   = style("Cap",      fontSize=7, leading=9, textColor=TEXT_MUTED,
                    alignment=TA_CENTER, spaceAfter=4)

# ─── FLOWABLES CUSTOMIZADOS ──────────────────────────────────────────────────
class HeaderBanner(Flowable):
    def __init__(self, width, height=80):
        super().__init__()
        self.width  = width
        self.height = height

    def draw(self):
        c = self.canv
        c.setFillColor(MUTED_SLATE)
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=0)
        c.setStrokeColor(ACCENT_BLUE)
        c.setLineWidth(1.2)
        c.roundRect(0, 0, self.width, self.height, 6, fill=0, stroke=1)
        c.setFillColor(ACCENT_BLUE)
        c.roundRect(0, self.height-3.5, self.width, 3.5, 2, fill=1, stroke=0)

class SectionDivider(Flowable):
    def __init__(self, width, color=ACCENT_BLUE):
        super().__init__()
        self.width  = width
        self.color  = color
        self.height = 1.5

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.rect(0, 0, self.width, 1.5, fill=1, stroke=0)

class AlertBox(Flowable):
    def __init__(self, title, body, width, alert_type="warning", height=50):
        super().__init__()
        self.title = title
        self.body = body
        self.width = width
        self.alert_type = alert_type
        self.height = height

    def draw(self):
        c = self.canv
        colors = {
            "danger":  (HexColor("#3f1212"), DANGER),
            "warning": (HexColor("#38230b"), WARNING),
            "info":    (HexColor("#0f243d"), ACCENT_BLUE),
            "success": (HexColor("#0d301b"), SUCCESS),
        }
        bg, border = colors.get(self.alert_type, colors["info"])
        
        c.setFillColor(bg)
        c.roundRect(0, 0, self.width, self.height, 5, fill=1, stroke=0)
        c.setStrokeColor(border)
        c.setLineWidth(1)
        c.roundRect(0, 0, self.width, self.height, 5, fill=0, stroke=1)
        
        c.setFillColor(border)
        c.roundRect(0, 0, 4, self.height, 2, fill=1, stroke=0)
        
        c.setFillColor(border)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(12, self.height - 14, self.title)
        
        c.setFillColor(TEXT_PRIMARY)
        c.setFont("Helvetica", 7.5)
        
        words = self.body.split()
        lines, cur = [], ""
        for w in words:
            test = (cur + " " + w).strip()
            if c.stringWidth(test, "Helvetica", 7.5) < (self.width - 20):
                cur = test
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
            
        y = self.height - 25
        for line in lines[:3]:
            c.drawString(12, y, line)
            y -= 9.5

def bullet(text, color=ACCENT_BLUE):
    marker = f'<font color="#{color.hexval()[2:]}">▸</font>'
    return Paragraph(f"{marker}  {text}", S_BULLET)

def section_header(text, color=ACCENT_BLUE):
    return [
        SectionDivider(W, color=color),
        Spacer(1, 3),
        Paragraph(text, S_H1),
        Spacer(1, 2),
    ]

def background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG_DARK)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setFillColor(TEXT_MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(
        A4[0]/2, 0.9*cm,
        f"No Lost Media Launcher — Estudo Técnico: Repositório Privado & Auto-Update — Página {doc.page} de 4"
    )
    canvas.restoreState()

# ─── CONTEÚDO STORY ──────────────────────────────────────────────────────────
story = []

# ==============================================================================
# PÁGINA 1: VISÃO GERAL & DIAGNÓSTICO DO AUTO-UPDATE
# ==============================================================================
story.append(HeaderBanner(W, height=72))
story.append(Spacer(1, -62))
story.append(Paragraph("No Lost Media Launcher", S_TITLE))
story.append(Paragraph("Guia Técnico: Migração para Repositório Privado & Impacto no Auto-Update", S_SUBTITLE))
story.append(Spacer(1, 16))

story.append(Paragraph(
    "Este documento analisa os impactos de tornar o repositório <b>SarmentoCaio/No-Lost-Media-Launcher</b> privado no GitHub. "
    "Privar o repositório protege a propriedade intelectual do código-fonte e da arquitetura do catálogo, mas "
    "<b>interrompe imediatamente o sistema de auto-update integrado</b> caso não seja adotada uma das arquiteturas "
    "de desacoplamento descritas neste relatório.",
    S_BODY
))
story.append(Spacer(1, 0.2*cm))

story += section_header("1. Diagnóstico: O Auto-Update será Afetado?", ACCENT_BLUE)
story.append(Paragraph(
    "<b>SIM. O auto-update deixará de funcionar de forma imediata e transparente para os usuários.</b> "
    "A infraestrutura atual do Launcher consome dois pontos de acesso no GitHub, ambos bloqueados pelo modo privado:",
    S_BODY
))

story.append(bullet("<b>Bloqueio na API de Releases (updateService.ts):</b> A rota <code>api.github.com/repos/.../releases/latest</code>, "
                   "consultada pelo frontend para exibir o modal de nova versão, retorna <b>HTTP 404 Not Found</b> para chamadas não autenticadas "
                   "em repositórios privados. O código trata 404 como ausência de atualizações, de modo que o usuário nunca saberá que existe uma versão nova."))

story.append(bullet("<b>Bloqueio no Endpoint Estático do Tauri (tauri.conf.json):</b> O plugin <code>tauri-plugin-updater</code> busca o arquivo "
                   "<code>.../releases/latest/download/latest.json</code>. No GitHub privado, downloads anônimos de assets de release são "
                   "bloqueados (retornam 404 ou redirecionamento HTML para a tela de login do GitHub). A validação de assinatura Ed25519 falha."))

story.append(bullet("<b>Bloqueio no Download do Executável (.exe):</b> Mesmo que o link do instalador seja conhecido, o download do binário "
                   "<code>No-Lost-Media-Launcher-Setup.exe</code> na CDN do GitHub exige cabeçalhos com token de acesso ao repositório."))

story.append(Spacer(1, 0.2*cm))

status_data = [
    [Paragraph("Ponto de Consulta", S_TABLE_H),
     Paragraph("Repositório Público (Atual)", S_TABLE_H),
     Paragraph("Repositório Privado (Sem Ajuste)", S_TABLE_H)],
    [Paragraph("GitHub API (<code>/releases/latest</code>)", S_TABLE_CL),
     Paragraph("✅ HTTP 200 (JSON público)", S_TABLE_C),
     Paragraph("❌ HTTP 404 Not Found (Bloqueado)", S_TABLE_C)],
    [Paragraph("Manifesto Tauri (<code>latest.json</code>)", S_TABLE_CL),
     Paragraph("✅ HTTP 302/200 (Acesso livre)", S_TABLE_C),
     Paragraph("❌ HTTP 404 / Redirect Login HTML", S_TABLE_C)],
    [Paragraph("Download do Instalador (<code>.exe</code>)", S_TABLE_CL),
     Paragraph("✅ Download direto via CDN", S_TABLE_C),
     Paragraph("❌ Acesso negado sem token", S_TABLE_C)],
    [Paragraph("Comportamento no App do Usuário", S_TABLE_CL),
     Paragraph("✅ Atualização silenciosa em background", S_TABLE_C),
     Paragraph("❌ Nunca encontra atualizações", S_TABLE_C)],
]

tbl_status = Table(status_data, colWidths=[5.8*cm, 5.8*cm, 5.8*cm], repeatRows=1)
tbl_status.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), MUTED_BLUE),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [MUTED_SLATE, CODE_BG]),
    ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0),(-1,-1), 4),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
    ("RIGHTPADDING",(0,0), (-1,-1), 6),
    ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
]))
story.append(tbl_status)

story.append(PageBreak())

# ==============================================================================
# PÁGINA 2: SEGURANÇA (TOKEN NO CLIENT) & OUTRAS PREOCUPAÇÕES
# ==============================================================================
story += section_header("2. Risco Crítico: Por que NUNCA embutir um Token no App", DANGER)
story.append(Paragraph(
    "A solução intuitiva mais rápida para tentar viabilizar o download seria gerar um <i>Personal Access Token (PAT)</i> "
    "do GitHub e colocá-lo no código do Launcher para autenticar as requisições. <b>Isso é uma grave falha de segurança:</b>",
    S_BODY
))

story.append(AlertBox(
    title="RISCO DE VAZAMENTO INTEGRAL DO REPOSITÓRIO PRIVADO",
    body="Qualquer executável distribuído aos usuários pode ser inspecionado. "
         "Com ferramentas simples (Strings, Proxies HTTP como Fiddler ou Wireshark, ou descompiladores JS), "
         "o token pode ser extraído em minutos. Um usuário mal-intencionado ganha acesso total ao seu código e issues.",
    width=W,
    alert_type="danger",
    height=48
))
story.append(Spacer(1, 0.15*cm))

story.append(bullet("<b>Descompilação Trivial de Frontend:</b> O código do launcher empacotado no executável do Tauri contém os arquivos "
                   "JavaScript do frontend. Mesmo minificados, tokens do GitHub (com prefixo <code>ghp_</code>) são facilmente localizáveis."))
story.append(bullet("<b>Interceptação de Tráfego de Rede:</b> Qualquer usuário monitorando sua própria placa de rede verá o cabeçalho "
                   "<code>Authorization: Bearer [token]</code> enviado para a API do GitHub nas requisições do launcher."))
story.append(bullet("<b>Princípio Zero-Trust:</b> O cliente desktop é considerado ambiente inseguro. Credenciais com permissões de acesso "
                   "a repositórios privados <b>jamais</b> devem ser embutidas em binários entregues ao público."))

story.append(Spacer(1, 0.2*cm))
story += section_header("3. Outras Preocupações Operacionais com Repo Privado", WARNING)
story.append(Paragraph(
    "Além da quebra do autoupdate, a mudança para repositório privado acarreta mudanças importantes no dia a dia do projeto:",
    S_BODY
))

story.append(KeepTogether([
    Paragraph('<font color="#f59e0b">⏱</font>  <b>Cota de Minutos do GitHub Actions (CI/CD)</b>', S_H2),
    Paragraph("Repositórios públicos possuem minutos de execução <b>ilimitados e gratuitos</b> no GitHub Actions. "
              "Repositórios privados no plano Free possuem cota de <b>2.000 minutos/mês</b> compartilhada em toda a conta. "
              "Compilações de Rust e MSVC levam de 3 a 5 minutos por execução.", S_BODY),
]))

story.append(KeepTogether([
    Paragraph('<font color="#f59e0b">🔗</font>  <b>Quebra de Links Externos (Site e Redes Sociais)</b>', S_H2),
    Paragraph("Qualquer link no site <code>nolost.media</code>, em vídeos, posts ou tutoriais que aponte para "
              "<code>github.com/SarmentoCaio/No-Lost-Media-Launcher</code> passará a retornar erro 404 para quem não fizer parte da organização.", S_BODY),
]))

story.append(KeepTogether([
    Paragraph('<font color="#f59e0b">🐛</font>  <b>Perda de Issues e Feedback da Comunidade</b>', S_H2),
    Paragraph("Usuários externos não poderão mais abrir Issues no GitHub relatando bugs em jogos ou melhorias no launcher. "
              "Será indispensável disponibilizar um canal alternativo (ex: Discord oficial, formulário ou e-mail de suporte).", S_BODY),
]))

story.append(KeepTogether([
    Paragraph('<font color="#f59e0b">📦</font>  <b>Armazenamento e Quotas de Releases</b>', S_H2),
    Paragraph("Releases em repositórios privados contam diretamente no limite de armazenamento da conta GitHub (1 GB no plano gratuito), "
              "enquanto em repositórios públicos os instaladores não reduzem essa cota de storage.", S_BODY),
]))

story.append(PageBreak())

# ==============================================================================
# PÁGINA 3: AS 3 SOLUÇÕES ARQUITETURAIS & TABELA COMPARATIVA
# ==============================================================================
story += section_header("4. As 3 Soluções Arquiteturais Recomendadas", SUCCESS)
story.append(Paragraph(
    "Para manter o <b>código-fonte 100% privado</b> e garantir que o <b>auto-update continue funcionando de forma anônima e gratuita</b>, "
    "existem três soluções adotadas na indústria de software desktop:",
    S_BODY
))

# Solução 1
story.append(KeepTogether([
    Paragraph("⭐ <b>Solução 1: Repositório Público Dedicado a Releases (Altamente Recomendada)</b>", S_H2),
    Paragraph(
        "Esta é a arquitetura padrão utilizada por softwares fechados (ex: Obsidian, Notion). "
        "Separa-se o repositório de código do repositório de distribuição:",
        S_BODY
    ),
    bullet("<b>Repositório de Código (Privado):</b> <code>SarmentoCaio/No-Lost-Media-Launcher</code> (guarda o código-fonte, histórico e lógica)."),
    bullet("<b>Repositório de Releases (Público):</b> <code>SarmentoCaio/nlm-releases</code> (contém <b>somente</b> tags, instaladores <code>.exe</code> e o <code>latest.json</code>)."),
    bullet("<b>Funcionamento:</b> O build roda no repositório privado. Ao concluir, publica o release diretamente no repositório público usando o GitHub CLI (<code>gh release create --repo ...</code>). O launcher consulta o repo público."),
    bullet("<b>Vantagens:</b> Custo zero de infraestrutura; aproveita a CDN global ultrarrápida do GitHub; sem chaves no client; código 100% protegido."),
]))
story.append(Spacer(1, 0.15*cm))

# Solução 2
story.append(KeepTogether([
    Paragraph("🌐 <b>Solução 2: Cloudflare R2 / AWS S3 com Domínio Próprio (A mais Profissional)</b>", S_H2),
    Paragraph(
        "Armazenar o <code>latest.json</code> e os instaladores em um bucket Cloudflare R2 conectado a um subdomínio oficial "
        "(ex: <code>https://updates.nolost.media/latest.json</code>):",
        S_BODY
    ),
    bullet("<b>Cloudflare R2:</b> Compatível com S3 e com <b>custo zero de tráfego de saída (zero egress fee)</b>. Milhares de downloads de 7 MB não geram custos de banda."),
    bullet("<b>Vantagens:</b> Independência total de plataformas; URL com a marca própria No Lost Media; imune a eventuais bloqueios ou políticas do GitHub."),
]))
story.append(Spacer(1, 0.15*cm))

# Solução 3
story.append(KeepTogether([
    Paragraph("⚡ <b>Solução 3: Cloudflare Worker como Gateway Reverso Autenticado</b>", S_H2),
    Paragraph(
        "Manter as releases no próprio repositório privado e usar um Cloudflare Worker no meio do caminho para autenticar com segurança:",
        S_BODY
    ),
    bullet("O Launcher consulta <code>https://updates.nolost.media/latest.json</code> sem token."),
    bullet("O Worker (serverless na nuvem) intercepta a requisição, anexa o GitHub Token armazenado com segurança em seus secrets de backend, "
           "busca o release no repositório privado e entrega o conteúdo ao launcher. O token nunca sai do servidor seguro."),
]))

story.append(Spacer(1, 0.2*cm))
story += section_header("5. Comparativo das Soluções", ACCENT_BLUE)

sol_data = [
    [Paragraph("Critério", S_TABLE_H),
     Paragraph("Solução 1: Repo Público Releases", S_TABLE_H),
     Paragraph("Solução 2: Cloudflare R2 (S3)", S_TABLE_H),
     Paragraph("Solução 3: Cloudflare Worker", S_TABLE_H)],
    [Paragraph("<b>Privacidade do Código</b>", S_TABLE_CL),
     Paragraph("⭐⭐⭐⭐⭐ 100% Protegido", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐⭐ 100% Protegido", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐⭐ 100% Protegido", S_TABLE_C)],
    [Paragraph("<b>Custo Financeiro</b>", S_TABLE_CL),
     Paragraph("⭐⭐⭐⭐⭐ Gratuito", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐⭐ Gratuito (Zero Egress)", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐⭐ Gratuito (Plano Free)", S_TABLE_C)],
    [Paragraph("<b>Facilidade de Setup</b>", S_TABLE_CL),
     Paragraph("⭐⭐⭐⭐⭐ Simples (5 min)", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐ Médio (Bucket + DNS)", S_TABLE_C),
     Paragraph("⭐⭐⭐ Avançado (Código Worker)", S_TABLE_C)],
    [Paragraph("<b>Independência do GitHub</b>", S_TABLE_CL),
     Paragraph("⭐⭐⭐ Vinculado ao GitHub", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐⭐ 100% Independente", S_TABLE_C),
     Paragraph("⭐⭐⭐ Depende da API GitHub", S_TABLE_C)],
    [Paragraph("<b>Velocidade e CDN</b>", S_TABLE_CL),
     Paragraph("⭐⭐⭐⭐⭐ CDN GitHub Fastly", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐⭐ CDN Cloudflare Anycast", S_TABLE_C),
     Paragraph("⭐⭐⭐⭐ Proxy intermediário", S_TABLE_C)],
]

tbl_sol = Table(sol_data, colWidths=[4.2*cm, 4.4*cm, 4.4*cm, 4.4*cm], repeatRows=1)
tbl_sol.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), MUTED_BLUE),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [MUTED_SLATE, CODE_BG]),
    ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0),(-1,-1), 4),
    ("LEFTPADDING", (0,0), (-1,-1), 5),
    ("RIGHTPADDING",(0,0), (-1,-1), 5),
    ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
]))
story.append(tbl_sol)

story.append(PageBreak())

# ==============================================================================
# PÁGINA 4: PLANO PRÁTICO DE MIGRAÇÃO (PASSO A PASSO)
# ==============================================================================
story += section_header("6. Plano de Ação Recomendado (Passo a Passo)", SUCCESS)
story.append(Paragraph(
    "A <b>Solução 1 (Repositório Público de Releases)</b> é a rota de menor atrito, custo zero e máxima estabilidade. "
    "Abaixo está o roteiro de migração para que nenhum usuário fique sem atualização:",
    S_BODY
))

story.append(KeepTogether([
    Paragraph('<font color="#22c55e">1️⃣</font>  <b>Passo 1: Criar o Repositório de Releases no GitHub</b>', S_H2),
    Paragraph("Crie um repositório <b>público</b> vazio no GitHub chamado <code>SarmentoCaio/No-Lost-Media-Releases</code> "
              "(ou <code>nlm-releases</code>). Não adicione arquivos de código nele, apenas uma descrição simples informando "
              "que o repositório armazena os instaladores e atualizações oficiais do No Lost Media Launcher.", S_BODY),
]))

story.append(KeepTogether([
    Paragraph('<font color="#22c55e">2️⃣</font>  <b>Passo 2: Atualizar os Endpoints de Update no Projeto</b>', S_H2),
    Paragraph("No repositório do projeto, atualize os dois arquivos responsáveis pelas consultas de versão:<br/>"
              "• Em <code>apps/launcher/src-tauri/tauri.conf.json</code>:<br/>"
              "&nbsp;&nbsp;<code>\"endpoints\": [\"https://github.com/SarmentoCaio/No-Lost-Media-Releases/releases/latest/download/latest.json\"]</code><br/>"
              "• Em <code>apps/launcher/src/services/updateService.ts</code>:<br/>"
              "&nbsp;&nbsp;<code>export const GITHUB_REPO = \"SarmentoCaio/No-Lost-Media-Releases\";</code>", S_BODY),
]))

story.append(KeepTogether([
    Paragraph('<font color="#22c55e">3️⃣</font>  <b>Passo 3: Publicar a Versão de Transição no Repo de Releases</b>', S_H2),
    Paragraph("Faça o build da nova versão e publique no repositório de releases usando o GitHub CLI:<br/>"
              "<code>gh release create v0.1.4 release_assets/* --title \"No Lost Media Launcher 0.1.4\" --repo SarmentoCaio/No-Lost-Media-Releases</code><br/>"
              "Espelhe também os arquivos no repo antigo caso queira que os usuários antigos encontrem a versão 0.1.4.", S_BODY),
]))

story.append(KeepTogether([
    Paragraph('<font color="#22c55e">4️⃣</font>  <b>Passo 4: Alterar a Visibilidade do Repositório de Código para Privado</b>', S_H2),
    Paragraph("No GitHub, acesse <i>Settings → Danger Zone → Change repository visibility</i> no repositório principal e selecione <b>Private</b>. "
              "A partir desse momento, seu código-fonte, commits e histórico estão completamente protegidos e invisíveis para o público externo.", S_BODY),
]))

story.append(Spacer(1, 0.2*cm))

story.append(AlertBox(
    title="ESTRATÉGIA DE TRANSIÇÃO SUAVE (IMPORTANTE)",
    body="Para que os usuários que já utilizam a versão 0.1.3 atualizem automaticamente sem intervenção, "
         "publique a versão 0.1.4 em ambos os repositórios (antigo e novo) antes de privar o repositório principal. "
         "Assim que todos tiverem recebido a 0.1.4, pode-se privar o repositório antigo com total segurança.",
    width=W,
    alert_type="info",
    height=48
))

story.append(Spacer(1, 0.3*cm))
story.append(HRFlowable(width=W, thickness=0.5, color=BORDER))
story.append(Spacer(1, 0.15*cm))
story.append(Paragraph(
    "No Lost Media Launcher • Documentação de Arquitetura e Engenharia de Software • Confidencial e Interno",
    S_CAPTION
))

# ─── EXECUÇÃO ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    doc.build(story, onFirstPage=background, onLaterPages=background)
    print(f"PDF gerado com sucesso em: {OUTPUT_PATH}")
