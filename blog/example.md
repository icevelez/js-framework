+++
title=Welcome Blog
description=My first blog
thumbnail_url=../assets/happy-dog.webp
thumbnail_description=happy doggo
author=Iceberg Velez
year=2026
date=Jan 4
+++
![Happy Dog](../assets/happy-dog.webp)

# Hello viewer

This is my first blog. I don't know how blogs work or how to make so I'm just typing out what's on my mind

I was inspired to make this when I saw [Emil Privér's](https://priver.dev/) website which had this simple yet elegant look. It is powered by Hugo, a Framework that compiles markdown files as HTML using Go but I'd like to go on a different route

My set out goal was to create blog post client-side (browser) which means no build step therefore I can not use most SSG Frameworks and to achieve that my first idea was to convert a markdown (.md) file to HTML and inject it to the DOM which led me to search for JS markdown-to-html library like [Marked](https://github.com/markedjs/marked)

So the process would be to use `fetch` to download `index.md`, parse it as a text then use `marked.min.js` to convert it to HTML then insert it to `id="content"` and repeat that for every blog site that will come next

folder structure

```
├── index.html
├── style.css
├── marked.min.js
├── marked.build.js
└── blog
    ├── index.html
    └── welcome-blog
        ├── index.html
        └── index.md
    └── upcoming-blog...
        ├── index.html
        └── index.md
```

marked.build.js
```js
fetch("index.md").then((response) => response.text()).then((data) => {
    const contentElement = document.getElementById("content");
    if (!contentElement) {
        alert("content element not found")
        return;
    }

    try {
        if (!marked) {
            alert("marked.js not found")
            return;
        }
        contentElement.innerHTML = marked.parse(data)
    } catch (error) {
        alert("something went wrong converting markdown to html")
        console.error(error);
        return;
    }
}).catch((error) => {
    alert("failed to retrieve content");
    console.error(error);
})
```

This way I don't have the hassle of a build process but that also means I have to do things more manually like adding in a new blog entry in `/blog/index.html` every time I create a new blog, manually adding in HTML metadata for search engine and social messaging platform like `Discord` could properly parse my blogpost; There is also the caveat that `marked.js` brings like no syntax highlight for code blocks by default but overall it's an okay compromise as a start, things will change but how they'll change, time will tell
