# Estrutura do projeto

Este documento descreve a organização da aplicação sem alterar sua regra de negócio.

## Camadas principais

- `server.js`: composição do servidor Express, middlewares e registro das rotas.
- `src/routes/`: controladores HTTP separados por domínio funcional.
- `src/services/`: regras de aplicação, motores de análise, planejamento, IA e serviços auxiliares.
- `src/db/`: acesso ao PostgreSQL/Neon.
- `views/`: templates EJS e componentes parciais compartilhados.
- `public/`: estilos, scripts de interface e recursos estáticos.
- `db/migrations/`: migrações versionadas do banco de dados.
- `docs/`: documentação técnica e estrutural.

## Princípios adotados

1. Regras de negócio permanecem concentradas em serviços e rotas, não em CSS ou templates.
2. Alterações de apresentação devem ser feitas preferencialmente em `public/` e `views/partials/`.
3. Dados de cada aluno permanecem isolados por `user_id`.
4. Mudanças de banco devem ser idempotentes e versionadas.
5. Componentes de layout compartilhado devem ser mantidos em `views/partials/`.
6. Lógica de IA deve sempre ser validada pelo backend antes de persistir resultados críticos.

## Identidade do produto

Nome: **Dossiê de Preparação ESFCEx**  
Desenvolvedor: **Stanley Carvalho**  
Copyright: © 2026 Stanley Carvalho. Todos os direitos reservados.
