import { serverHooks } from '@vue-storefront/core/server/hooks'
import fetch from 'isomorphic-fetch'
import config from 'config'

import cache from '@vue-storefront/core/scripts/utils/cache-instance'

const cloudflareUrlsToPurge = []
// It says - max length equals 30
// https://api.cloudflare.com/#zone-purge-files-by-url
const cloudflareMaxChunkSize = 30
const cloudflarePurge = config.varnish && config.varnish.enabled && config.varnish.cloudflare && config.varnish.cloudflare.purge
const cloudflarePurgeRequest = async(urls: Array<string>): Promise<Response> => {
  const { zoneIdentifier, key } = config.varnish.cloudflare
  return await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneIdentifier}/purge_cache`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      files: urls
    })
  })
}

// There I will create (Tag -> URL) Map in Redis Cache
// So then I will be able to refresh certain URL based on requested Tags in CDN
if (cloudflarePurge) {
  serverHooks.beforeOutputRenderedResponse(({ output, req, context }) => {  
    const tagsArray = Array.from(context.output.cacheTags)
    const site = req.headers['x-vs-store-code'] || 'main'
  
    const promises = []
  
    for (let tag of tagsArray) {
      const tagUrlMap = `cloudflare:${site}:${tag}`
      promises.push(
        cache.get(tagUrlMap)
        .then(output => {
          const reqUrl = config.server.baseUrl + 
            (req.originalUrl.startsWith('/') ? req.originalUrl.substr(1) : req.originalUrl);
          cache.set(
            tagUrlMap,
            output === null ? [reqUrl] : Array.from(new Set([...output, reqUrl])),
            tagsArray
          ).catch(err => {
            console.log(`Could not save '${tag}' tag's URL`, err)
          })
        }).catch(err => {
          console.log(`Could not read '${tag}' tag's URL`, err)
        })
      )
    }
  
    Promise.all(promises).then(() => {
      console.log('Succesfully saved tag\'s URL', tagsArray)
    }).catch(err => {
      console.log('Failed while saving tag\'s URL', err)
    })
  
    return output
  })
}

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