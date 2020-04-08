

vcl 4.0;

import std;
# import bodyaccess;

# One config for API + Cache on one machine
# Ton nginx i've added
        # location /invalidate/ {
        #         proxy_set_header 'X-Target' 'API';
        #         proxy_set_header 'Access-Control-Allow-Origin' '*';
        #         proxy_set_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE';
        #         proxy_set_header 'Access-Control-Allow-Headers' 'X-Requested-With,Accept,Content-Type, Origin';

        #         proxy_pass http://localhost:8080/invalidate/;
        # }

 
acl purge {
  "localhost";   // IP which can BAN cache - it should be PWA's IP
}

backend default {
  .host = "localhost";
  .port = "3000";
}

backend api {
  .host = "localhost";
  .port = "8080";
}
 
sub vcl_recv {
  unset req.http.X-Body-Len;
  # Only allow BAN requests from IP addresses in the 'purge' ACL.
  if (req.method == "BAN") {
    # Same ACL check as above:
    if (!client.ip ~ purge) {
      return (synth(403, "Not allowed."));
    }
 
    # Logic for the ban, using the X-Cache-Tags header.
    if (req.http.X-VS-Cache-Tag) {
      ban("obj.http.x-vs-cache-tags ~ " + req.http.X-VS-Cache-Tag);
      return (synth(200, "Ban added."));
    }
    if (req.http.X-VS-Cache-Ext) {
      ban("req.url ~ " + req.http.X-VS-Cache-Ext);
      return (synth(200, "Ban added."));
    }
    if (!req.http.X-VS-Cache-Tag && !req.http.X-VS-Cache-Ext) {
      return (synth(403, "X-VS-Cache-Tag or X-VS-Cache-Ext header missing."));
    }
 
    # Throw a synthetic page so the request won't go to the backend.
    return (synth(403, "Nothing to do"));

  }

  # Choose backend
  # This custom header allows me to distuinguish target for /invalidate while using nginx proxy
  if (req.url ~ "^/api/" || req.http.X-Target ~ "API") {
    set req.backend_hint = api;
  } else {
    set req.backend_hint = default;
  }

  if (req.backend_hint == api) {
    if (req.url ~ "^\/api\/catalog\/") {
      # if (req.method == "POST") {
      #   # It will allow me to cache by req body in the vcl_hash
      #   std.cache_req_body(500KB);
      #   set req.http.X-Body-Len = bodyaccess.len_req_body();
      # }
  
      if ((req.method == "GET")) {
        return (hash);
      }
    }

    if (req.url ~ "^\/api\/stock\/") {
      if (req.method == "GET") {
        # M2 Stock
        return (hash);
      }
    }
  }

  if (!(req.url ~ "^\/invalidate")) {
    if (req.method == "GET") {
      return (hash);
    }
  }
 
  return (pipe);
 
}
 
sub vcl_hash {
  # To cache POST and PUT requests
  # if (req.http.X-Body-Len) {
  #   bodyaccess.hash_req_body();
  # } else {
    hash_data("");
  # }
}

sub vcl_backend_fetch {
    if (bereq.http.X-Body-Len) {
      set bereq.method = "POST";
    }
}
 
sub vcl_backend_response {
    # Set ban-lurker friendly custom headers.
    if (beresp.http.X-VS-Cache && beresp.http.X-VS-Cache ~ "Miss") {
      unset beresp.http.X-VS-Cache;
    }
    # cache only successfully responses and 404s
    if (beresp.status != 200 && beresp.status != 404) {
        set beresp.ttl = 0s;
        set beresp.uncacheable = true;
        return (deliver);
    }
    if (bereq.url ~ "^\/api\/stock\/") {
      set beresp.ttl = 900s; // 15 minutes
    }
    # if (beresp.http.content-type ~ "text") {
    #     set beresp.do_esi = true;
    # }
    if (bereq.url ~ "\.js$" || beresp.http.content-type ~ "text" || beresp.http.content-type ~ "json") {
        set beresp.do_gzip = true;
    }

    set beresp.http.X-Url = bereq.url;
    set beresp.http.X-Host = bereq.http.host;
}

sub vcl_deliver {
    if (obj.hits > 0) {
      set resp.http.X-Cache = "Hit";
      set resp.http.X-Cache-Hits = obj.hits;
    } else {
      set resp.http.X-Cache = "Miss";
    }
    unset resp.http.X-Varnish;
    unset resp.http.Via;
    unset resp.http.Age;
    unset resp.http.X-Purge-URL;
    unset resp.http.X-Purge-Host;
    # Remove ban-lurker friendly custom headers when delivering to client.
    unset resp.http.X-Url;
    unset resp.http.X-Host;
    # Comment these for easier Drupal cache tag debugging in development.
    unset resp.http.X-Cache-Tags;
    unset resp.http.X-Cache-Contexts;
}