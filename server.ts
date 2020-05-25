import { serverHooks } from '@vue-storefront/core/server/hooks'
import fetch from 'isomorphic-fetch'
import config from 'config'

serverHooks.beforeCacheInvalidated(async ({ tags, req }) => {
  if (!config.get('varnish.enabled') || !config.get('server.useOutputCache') || !config.get('server.useOutputCacheTagging')) {
    return
  }
  console.log('Invalidating PWA\'s Varnish Tags')
  for (let tag of tags) {
    if (config.server.availableCacheTags.indexOf(tag) >= 0 || config.server.availableCacheTags.find(t => {
      return tag.indexOf(t) === 0
    })) {

        if (cloudflarePurge) {
          const site = req.headers['x-vs-store-code'] || 'main'
          const tagUrlMap = `cloudflare:${site}:${tag}`
          try {
            let output: Array<string> = await cache.get(tagUrlMap)
            if (output) {
              cloudflareUrlsToPurge.push(...output)
            }
          } catch (err) {
            console.log(`Could not read '${tag}' tag's URL`, err)
          }
        }

        try {
          let text = await (await fetch(`http://${config.get('varnish.host')}:${config.get('varnish.port')}`, {
            method: 'BAN',
            headers: {
              'X-VS-Cache-Tag': tag
            } 
          })).text()

          if (text && text.includes('200 Ban added')) {
            console.log(
              `Tags invalidated successfully for [${tag}] in the Varnish`
            );
          } else {
            console.log(text)
            console.error(`Couldn't ban tag: ${tag} in the Varnish`);
          }

        } catch (err) {
          console.error(err)
        }

    } else {
      console.error(`Invalid tag name ${tag}`)
    }
  }

  if (cloudflarePurge && cloudflareUrlsToPurge.length) {
    let uniqueCloudflareUrlsToPurge = Array.from(new Set(cloudflareUrlsToPurge))
    do {
      const chunk = uniqueCloudflareUrlsToPurge.slice(0, cloudflareMaxChunkSize)
      console.log('Sending chunk', chunk)
      try {
        let response = await (await cloudflarePurgeRequest(chunk)).json()
        if (response.success) {
          console.log('Cloudflare Purge Success:', response)
        } else {
          console.log('Cloudflare Purge Error:', response)
        }
      } catch (err) {
        console.log('Cloudflare Purge Error:', err)
      }

      if (uniqueCloudflareUrlsToPurge.length > cloudflareMaxChunkSize) {
        uniqueCloudflareUrlsToPurge = uniqueCloudflareUrlsToPurge.slice(cloudflareMaxChunkSize)
      } else {
        uniqueCloudflareUrlsToPurge = []
      }
    } while (uniqueCloudflareUrlsToPurge.length > 0);
  }

})