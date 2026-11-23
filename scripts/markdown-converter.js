/**
 * Zero-Dependency Markdown and LaTeX Parser Module
 */
const MarkdownConverter = (() => {

  // --- LATEX RENDERER ---
  function renderLatexToHtml(latex, isBlock = false) {
    let expr = latex.trim();

    const symbolMap = {
      '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
      '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π', '\\sigma': 'σ',
      '\\phi': 'φ', '\\omega': 'ω', '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ',
      '\\Lambda': 'Λ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Omega': 'Ω',
      '\\pm': '±', '\\times': '×', '\\div': '÷', '\\cdot': '⋅', '\\infty': '∞',
      '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\equiv': '≡',
      '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\subseteq': '⊆', '\\sum': '∑',
      '\\prod': '∏', '\\int': '∫', '\\partial': '∂', '\\nabla': '∇', '\\sqrt': '√'
    };

    for (const [cmd, symbol] of Object.entries(symbolMap)) {
      const regex = new RegExp(cmd.replace('\\', '\\\\') + '(?![a-zA-Z])', 'g');
      expr = expr.replace(regex, symbol);
    }

    while (/\\frac\{([^{}]+)\}\{([^{}]+)\}/.test(expr)) {
      expr = expr.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num, den) => {
        return `<span class="math-frac"><span class="math-num">${num}</span><span class="math-den">${den}</span></span>`;
      });
    }

    expr = expr.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
    expr = expr.replace(/\^([a-zA-Z0-9±+-]+)/g, '<sup>$1</sup>');
    expr = expr.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
    expr = expr.replace(/_([a-zA-Z0-9±+-]+)/g, '<sub>$1</sub>');

    const wrapperClass = isBlock ? 'math-block' : 'math-inline';
    const tag = isBlock ? 'div' : 'span';
    return `<${tag} class="${wrapperClass}">${expr}</${tag}>`;
  }

  // --- INLINE & BLOCK PARSING HELPERS ---
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function parseInline(text, mathStore) {
    // Pull out inline code FIRST so bold/italic/link rules can't touch its contents
    const codeSpans = [];
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      codeSpans.push(`<code>${escapeHtml(code)}</code>`);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });

    // Restore LaTeX placeholders
    text = text.replace(/__INLINE_MATH_(\d+)__/g, (_, id) => renderLatexToHtml(mathStore.inline[id], false));
    text = text.replace(/__BLOCK_MATH_(\d+)__/g, (_, id) => renderLatexToHtml(mathStore.block[id], true));

    // Bold & Italic
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Underscore emphasis only counts at word boundaries, so snake_case_names survive
    text = text.replace(/(?<![A-Za-z0-9])___([^_]+)___(?![A-Za-z0-9])/g, '<strong><em>$1</em></strong>');
    text = text.replace(/(?<![A-Za-z0-9])__([^_]+)__(?![A-Za-z0-9])/g, '<strong>$1</strong>');
    text = text.replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '<em>$1</em>');

    // Images (must run before links: ![alt](src))
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Restore code spans
    text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[i]);

    return text;
  }

  // --- MAIN PARSER ---
  function parse(markdown) {
    if (!markdown) return '';

    // 1. Isolate LaTeX blocks to prevent Markdown parsers from interfering
    const mathStore = { block: [], inline: [] };

    // Extract block math ($$ ... $$)
    markdown = markdown.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
      const id = mathStore.block.length;
      mathStore.block.push(math);
      return `\n\n__BLOCK_MATH_${id}__\n\n`;
    });

    // Extract inline math ($ ... $)
    markdown = markdown.replace(/\$([^\s$](?:[^$]*[^\s$])?)\$/g, (_, math) => {
      const id = mathStore.inline.length;
      mathStore.inline.push(math);
      return `__INLINE_MATH_${id}__`;
    });

    // Normalize line endings and split into blocks
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let html = [];
    let inList = false;
    let inCodeBlock = false;
    let codeBuffer = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Code blocks (```)
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          if (inList) { html.push('</ul>'); inList = false; }
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Block math placeholders rendered as block elements
      if (line.trim().match(/^__BLOCK_MATH_\d+__$/)) {
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(parseInline(line.trim(), mathStore));
        continue;
      }

      // Headings (# through ###)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (inList) { html.push('</ul>'); inList = false; }
        const level = headingMatch[1].length;
        html.push(`<h${level}>${parseInline(headingMatch[2], mathStore)}</h${level}>`);
        continue;
      }

      // Blockquotes (>)
      if (line.startsWith('> ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(`<blockquote>${parseInline(line.slice(2), mathStore)}</blockquote>`);
        continue;
      }

      // Unordered Lists (* or -)
      const listMatch = line.match(/^[\*\-]\s+(.+)$/);
      if (listMatch) {
        if (!inList) {
          html.push('<ul>');
          inList = true;
        }
        html.push(`<li>${parseInline(listMatch[1], mathStore)}</li>`);
        continue;
      } else if (inList) {
        html.push('</ul>');
        inList = false;
      }

      // Horizontal Rule (---)
      if (/^[\-\*_]{3,}$/.test(line.trim())) {
        html.push('<hr>');
        continue;
      }

      // Paragraphs
      if (line.trim() === '') {
        continue;
      }

      html.push(`<p>${parseInline(line, mathStore)}</p>`);
    }

    if (inList) html.push('</ul>');
    if (inCodeBlock) html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);

    return html.join('\n');
  }

  return { parse };

})();

// Allow `require()` from the Node build script; harmless in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarkdownConverter;
}