# @rubys/stimulus-live-elements

**Status: ALPHA**

API may change dramatically before release.  For now, pin a specific version.

## Usage

See [gist](https://gist.github.com/rubys/2f94bffcd369f1c014fef35fd355beba) or
run the following commang to get started:

```sh
bin/importmap pin @rubys/stimulus-live-elements@0.0.5
echo 'export { default } from  "@rubys/stimulus-live-elements"' > \
  app/javascript/controllers/live_elements_controller.js
```

Add `data-controller="live-elements"` to your containing HTML element.
For example, if you are using a Rails form:

```erb
<%= form_with data: {controller: "live-elements"} do |form| %>
```

Within that containing element, you can associate DOM events with
Rails actions by adding `data-action` attributes.  For example,
to cause a button clike to invoke a demo#click controller action
on the server, do something like the following:

```erb
<%= form.button "blue", name: 'color',
  data: {action: {click: demo_click_path}}
%>
```

In your server, produce a [turbostream](https://turbo.hotwired.dev/handbook/streams) response.  An example of a response that replaces a header:

```ruby
respond_to do |format|
  format.turbo_stream {
    render turbo_stream: turbo_stream.replace('header',
      render_to_string(partial: 'header', locals: {color: color}))
  }
end
```
