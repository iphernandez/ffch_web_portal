import { Component, signal } from '@angular/core';
import { marked } from 'marked';

const GITHUB_REPOSITORY_URL = 'https://github.com/iphernandez/ffch_web_portal';

@Component({
  selector: 'app-help',
  templateUrl: './help.component.html',
  styleUrl: './help.component.scss'
})
export class HelpComponent {
  readonly repositoryUrl = GITHUB_REPOSITORY_URL;
  readonly webAppReadme = signal('');
  readonly ffchReadme = signal('');
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  constructor() {
    void this.loadReadmes();
  }

  private async loadReadmes(): Promise<void> {
    try {
      const [webAppMarkdown, ffchMarkdown] = await Promise.all([
        this.fetchReadme('docs/webapp-readme.md'),
        this.fetchReadme('docs/ffch-puntuacion-readme.md')
      ]);
      this.webAppReadme.set(marked.parse(webAppMarkdown, { async: false }));
      this.ffchReadme.set(marked.parse(ffchMarkdown, { async: false }));
    } catch {
      this.errorMessage.set('No se pudo cargar la documentación. Intenta recargar la página.');
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchReadme(path: string): Promise<string> {
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
    return response.text();
  }
}
