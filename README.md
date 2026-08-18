# ESFCEx Informática Prep

## Banco de dados

A aplicação utiliza PostgreSQL no Neon. Configure `DATABASE_URL` com a conexão agrupada
(`-pooler`) e defina um `SESSION_SECRET` forte. O arquivo `.env.example` contém todas as
variáveis necessárias, sem credenciais reais.

Para preparar um banco vazio e carregar o conteúdo de referência:

```bash
npm run db:migrate
npm run seed
```

Após alterar variáveis de ambiente na Vercel, gere um novo deployment para aplicá-las.

Plataforma de preparação para o Exame Intelectual do concurso **EsFCEx** (Escola de Saúde e Formação Complementar do Exército), banca **VUNESP**, cargo **Informática**.

Cruza o histórico de provas da banca para identificar padrões de cobrança por disciplina/assunto, gera um plano de estudos priorizado, monta simulados respeitando a proporção real de disciplinas da prova, e usa IA (Google Gemini) para importar provas em PDF, gerar explicações de questões e questões de treino extras.

> ⚠️ **Importante sobre "previsão da prova de 2027"**: nenhuma ferramenta consegue prever questões literais de uma prova futura. O que esta aplicação faz é uma **projeção estatística de peso por disciplina/assunto**, com base na tendência histórica — o que é, de fato, o que determina onde vale mais a pena estudar. O relatório de padrões deixa isso explícito.

## 1. Correção importante

A banca organizadora do EsFCEx **não é** o "Instituto Verbena" — é a **Fundação VUNESP**. O Instituto Verbena/UFG organiza outros concursos (ex: IFS-Sergipe, prefeituras de Goiás), sem relação com o EsFCEx. O projeto já está configurado com VUNESP como banca padrão.

## 2. O que já vem pronto

- Banco de dados semeado com a distribuição real de disciplinas das provas **2022, 2023, 2024 e 2025** (dados públicos agregados de qconcursos/pciconcursos), suficiente para o dashboard e os simulados funcionarem desde o primeiro uso.
- Importador de PDF com IA: envie os PDFs oficiais (baixados gratuitamente em vunesp.com.br) e a aplicação extrai e classifica as questões automaticamente, para você ter o **banco de questões completo com enunciados reais**.
- Gerador de relatório de padrões, plano de estudos, simulados com blueprint real, explicações de questão sob demanda.

## 3. Conseguindo a chave de API gratuita (Google Gemini)

Este projeto usa o **Google Gemini** como motor de IA — tem tier gratuito real, sem cartão de crédito, com limites de uso (suficiente para uso pessoal: extrair provas, gerar relatórios, rodar simulados).

1. Acesse `https://aistudio.google.com/apikey` e faça login com uma conta Google.
2. Clique em **"Create API key"**.
3. Copie a chave e cole no `.env` na linha `GEMINI_API_KEY=`.

Limites do tier gratuito (podem mudar — confira em `ai.google.dev/gemini-api/docs/rate-limits`): algumas dezenas de requisições por minuto e até ~1500 por dia, dependendo do modelo. Para o uso deste app (importar algumas provas, gerar relatórios pontualmente, rodar simulados), isso é bem confortável. Se em algum momento bater o limite, é só esperar um minuto e tentar de novo — o app mostra o erro claramente na tela.

## 4. Rodando localmente

Pré-requisitos: Node.js 18+.

```bash
npm install
cp .env.example .env
# edite o .env e cole sua GEMINI_API_KEY (necessária para os recursos de IA)
npm run seed   # popula o banco com os dados históricos (só precisa rodar uma vez)
npm start
```

Acesse `http://localhost:3000`.

Sem a `GEMINI_API_KEY`, a aplicação funciona parcialmente: dashboard, banco de questões e simulados (com questões já importadas) funcionam normalmente; os recursos que chamam IA (análise de padrões, plano de estudos, importação de PDF, explicações, preenchimento de simulado com questões de treino) mostram uma mensagem de erro clara pedindo a chave.

## 5. Importando as provas oficiais (passo a passo)

1. Acesse `vunesp.com.br`, procure o concurso **EsFCEx** do ano desejado (ex: ESEX2301 para 2025, e os anos anteriores têm códigos parecidos).
2. Na seção **"Provas e Gabaritos"**, baixe o PDF da prova do cargo **Informática** (às vezes chamado "Analista de TI" ou "Técnico de Nível Superior - Informática").
3. Na aplicação, vá em **Importar provas**, selecione o PDF, informe o ano, e envie.
4. A IA extrai automaticamente enunciado, alternativas, disciplina, assunto e gabarito (se estiver no PDF) de cada questão.
5. Repita para o máximo de anos que conseguir (idealmente as últimas 8-10 provas, incluindo cargos correlatos como "Analista de TI" e "Oficial do Quadro Complementar - Informática", que costumam repetir grade curricular).
6. Depois de importar, gere/regere o relatório de **Análise de padrões** e o **Plano de estudos** para incorporar os dados novos.

Como o cargo de Informática do EsFCEx costuma ter poucas vagas (às vezes vagas zero em algum ano), talvez não haja prova de Informática todo ano — nesse caso vale importar também as provas de anos com o cargo mais próximo (ex: "Analista de Tecnologia da Informação") e, se quiser mais volume de questões técnicas, provas de TI de outros concursos VUNESP com perfil parecido (mesma banca = mesmo estilo de redação de questão).

## 6. Estrutura do projeto

```
server.js                  # entrada da aplicação (Express)
src/
  db/
    schema.sql             # schema do SQLite
    db.js                  # conexão + criação automática do schema
    seed.js                # popula com dados históricos de referência
  services/
    aiService.js           # toda a integração com IA (Google Gemini API)
    pdfService.js           # extração de texto de PDF
    simuladoEngine.js       # monta simulados respeitando o blueprint histórico
  routes/
    main.js                 # dashboard, análise de padrões, plano de estudos, banco de questões
    import.js               # upload e importação de provas em PDF
    simulados.js            # criação, execução e correção de simulados
views/                      # templates EJS (tema "dossiê operacional")
public/style.css            # design system
data/reference_exams.json   # dados históricos de referência (seed)
```

## 7. Deploy (web app hospedada)

### Opção rápida: Railway ou Render

1. Suba este projeto para um repositório no GitHub.
2. No [Railway](https://railway.app) ou [Render](https://render.com), crie um novo serviço a partir do repositório (ambos detectam o `Dockerfile` automaticamente).
3. Configure a variável de ambiente `GEMINI_API_KEY` no painel do serviço.
4. **Atenção ao volume de dados**: por padrão o SQLite fica no filesystem do container, que é efêmero em muitos provedores (os dados somem a cada novo deploy). Para persistência real:
   - Railway: adicione um **Volume** e aponte `DB_PATH` para dentro dele (ex: `/data/esfcex.db`).
   - Render: use um **Persistent Disk** e faça o mesmo.
5. Depois do primeiro deploy, rode `npm run seed` uma vez (via shell do provedor) se o volume estiver vazio.

### Docker local

```bash
docker build -t esfcex-prep .
docker run -p 3000:3000 -e GEMINI_API_KEY=xxxx esfcex-prep
```
