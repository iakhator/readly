function renderReadingTime(article: HTMLElement): void {

  console.log("Rendering reading time badge...", article);
  if(!article) {
    return;
  }

  const text = article.textContent || "";
  const wordMatchRegExp = /[^\s]+/g;
  const words = text.match(wordMatchRegExp) || [];
  const wordCount = [...words].length;
  const readingTime = Math.ceil(wordCount / 200);
  const badge = document.createElement("p");

  badge.classList.add("color-secondary-text", "type-caption");
  badge.textContent = `Estimated reading time: ${readingTime} min read`;

  const heading = article.querySelector("h1");

  const date = article.querySelector("time")?.parentElement;

  const anchor = date ?? heading;
  if (!anchor) return;
  anchor.insertAdjacentElement("afterend", badge);
}

const article = document.querySelector("article");

if (article instanceof HTMLElement) {
  renderReadingTime(article);
}

const observer = new MutationObserver((mutations) => {
  for(const mutation of mutations) {
    for(const node of mutation.addedNodes) { 
      if(node instanceof HTMLElement && node.tagName.toLowerCase() === "article") {
        renderReadingTime(node);
      }
    }
  }
});

const devSite = document.querySelector('devsite-content');
if (devSite) {
  console.log("Observing devsite-content for DOM mutations...");
  observer.observe(devSite, { childList: true, subtree: true });
} else {
  console.warn("devsite-content element not found. MutationObserver will not be set up.");
}
