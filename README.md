# 📊 Dashboard Financeiro WGF
**WGF Construções e Consultoria — Painel Executivo de Fluxo de Caixa**

---

## 🚀 Como publicar no GitHub Pages

### Passo 1 — Adicione o logo
Copie o arquivo do logo (PNG com fundo branco ou transparente) para dentro da pasta `assets/` com o nome **`logo.png`**.

### Passo 2 — Crie o repositório no GitHub
1. Acesse [github.com](https://github.com) e faça login (crie uma conta se não tiver)
2. Clique em **"New repository"** (botão verde no canto superior direito)
3. Nome sugerido: `wgf-dashboard`
4. Marque como **Public**
5. Clique em **"Create repository"**

### Passo 3 — Faça upload dos arquivos
Na página do repositório recém-criado:
1. Clique em **"uploading an existing file"**
2. Arraste TODA a pasta `dashboard-wgf` (ou seu conteúdo) para a área de upload
3. Confirme o commit clicando em **"Commit changes"**

> **Importante:** certifique-se de que os arquivos estejam na raiz do repositório:
> ```
> index.html
> styles.css
> app.js
> assets/logo.png
> ```

### Passo 4 — Ative o GitHub Pages
1. No repositório, clique em **Settings** (aba superior)
2. No menu lateral, clique em **Pages**
3. Em "Source", selecione **Deploy from a branch**
4. Branch: **main** | Folder: **/ (root)**
5. Clique em **Save**

Após 1-2 minutos, seu dashboard estará disponível em:
```
https://SEU_USUARIO.github.io/wgf-dashboard/
```

---

## 🔄 Atualização dos dados

Os dados são lidos automaticamente da planilha Google Sheets a cada **2 minutos**.
Para atualizar manualmente, clique no botão **"↺ Atualizar"** no canto superior direito.

Para atualizar os lançamentos: edite diretamente a aba **Base_de_Dados** no Google Sheets.
As mudanças aparecerão no dashboard na próxima atualização.

---

## ⚙️ Configuração da Planilha

A planilha Google Sheets deve estar compartilhada como:
**"Qualquer pessoa com o link pode visualizar"**

Para verificar:
1. Abra a planilha no Google Sheets
2. Clique em **Compartilhar** (canto superior direito)
3. Em "Acesso geral", selecione **"Qualquer pessoa com o link"** com permissão de **Visualizador**

---

## 📁 Estrutura do projeto

```
dashboard-wgf/
├── index.html      ← Estrutura HTML do dashboard
├── styles.css      ← Estilos (tema dark navy/gold WGF)
├── app.js          ← Lógica: busca de dados, filtros, gráficos, tabela
├── assets/
│   └── logo.png    ← Logo WGF (adicionar manualmente)
└── README.md       ← Este arquivo
```

---

## 🛠️ Tecnologias

- **HTML5 + CSS3 + JavaScript** (sem dependências de servidor)
- **Chart.js 4.4** — gráficos interativos
- **Google Sheets gviz API** — dados em tempo real sem API key
- **GitHub Pages** — hospedagem gratuita e link permanente
