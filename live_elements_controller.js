import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="live-elements"
export default class extends Controller {
  connect() {
    this.token = document.querySelector(
      'meta[name="csrf-token"]'
    ).content;

    for (let element of this.element.querySelectorAll("*[data-action]")) {
      for (let [type, path] of Object.entries(JSON.parse(element.dataset.action))) {
        element.addEventListener(type, event => {
          event.preventDefault();

          let method = "post";
          let form;

          if (element.form) {
            method = element.form.method;
            form = new FormData(element.form);
          } else {
            form = new FormData();
          }

          if (element.nodeName == 'BUTTON') {
            form.append(element.name, element.textContent);
          }

          fetch(path, {
            method: method,
            headers: {
              'X-CSRF-Token': this.token,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            credentials: 'same-origin',
            body: (new URLSearchParams(form)).toString()
          }).then (response => response.text())
          .then(html => Turbo.renderStreamMessage(html));
        })
      }
    }
  }
}
