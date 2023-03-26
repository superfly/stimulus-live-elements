import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="live-elements"
export default class extends Controller {
  connect() {
    // extract CSRF token for later use in building fetch headers
    this.token = document.querySelector(
      'meta[name="csrf-token"]'
    ).content;

    this.queue = Promise.resolve();

    // monitor this element for actions
    this.monitor(this.element);

    // when nodes are added, monitor them too
    this.observer = new MutationObserver(mutationsList => {
      mutationsList.forEach(mutation => {
        mutation.addedNodes.forEach(addedNode => {
          this.monitor(addedNode);
        });
      });
    });

    this.observer.observe(this.element, { subtree: true, childList: true });
  }

  disconnect() {
    this.observer.disconnect();
  }

  // find all data-action attributes and serialize event execution
  monitor(root) {
    for (let element of root.querySelectorAll("*[data-action]")) {
      for (let [type, path] of Object.entries(JSON.parse(element.dataset.action))) {
        element.addEventListener(type, event => {
          event.preventDefault();

          this.queue = this.queue.then(() => new Promise((resolve, reject) => {
            this.execute(element, path, event, resolve);
          }))
        })
      }
    }
  }

  // process actions by building form parameters, executing a fetch request,
  // and processing results as a turbostream
  execute(element, path, event, resolve) {
    let method = "post";
    let form;
    let body = null;

    // if this element is assocaited with a form, get the form data to submit
    if (element.form) {
      method = element.form.method;
      form = new FormData(element.form);
    } else {
      form = new FormData();
    }

    // if a button was pressed, add it to the data to submit
    if (element.nodeName == 'BUTTON') {
      form.append(element.name, element.textContent);
    }

    // for get requests, set search parameters, otherwise set body
    if (method.toLowerCase() == 'get') {
      path = new URL(path, window.location)
      for (let [key, value] of form.entries()) {
        path.searchParams.append(key, value);
      }
    } else {
      body = (new URLSearchParams(form)).toString()
    }

    // issue fetch request and process the response as a turbo stream
    fetch(path, {
      method: method,
      headers: {
        'X-CSRF-Token': this.token,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      credentials: 'same-origin',
      body: body
    }).then(response => response.text())
      .then(html => Turbo.renderStreamMessage(html))
      .finally(() => setTimeout(resolve, 100));
      // "Since Turbo Streams are customElements, 
      // there's no way to know when they're finished executing"
      // -- https://github.com/rails/request.js/issues/35
  }
}
