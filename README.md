# Santos Desentope

App (PWA) para gerir trabalhos de desentupimento, com notificações no telemóvel.

- **Frontend:** este repositório, publicado com GitHub Pages.
- **Backend:** Google Apps Script ligado a uma folha Google Sheets própria (código em `apps-script/Code.gs`).
- **Notificações:** Web Push com chaves VAPID geradas no próprio Apps Script (guardadas nas Propriedades do script).

Os PINs dos utilizadores estão só na folha Google (separador *Utilizadores*).
Para mudar um PIN, um técnico ou um dono, edita esse separador.

Projeto independente — não partilha código, folha nem chaves com outros apps.
