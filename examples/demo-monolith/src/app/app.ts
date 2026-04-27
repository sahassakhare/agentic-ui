import { Component } from '@angular/core';
import { ChatShellComponent } from '@maverick/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  styleUrl: './app.scss',
  template: `
    <header>
      <h1>@maverick/agentic-ui — demo-monolith</h1>
      <p>Connected to local AG-UI agent server. Type a message to echo it back, streamed word-by-word.</p>
    </header>
    <main>
      <mvk-chat-shell />
    </main>
  `,
})
export class App {}
