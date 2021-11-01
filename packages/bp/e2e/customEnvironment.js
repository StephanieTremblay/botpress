const PuppeteerEnvironment = require('jest-environment-puppeteer')

class CustomEnvironment extends PuppeteerEnvironment {
  savePath = path.join(__dirname, '../../../', 'build/tests/e2e/screenshots')

  async handleTestEvent(event, _state) {
    if (event.name === 'test_fn_failure') {
      const filename = path.format({ dir: this.savePath, name: event.test.name, ext: '.png' })

      // Take a screenshot at the point of failure
      await this.global.page.screenshot({ path: filename })
    }
  }
}
module.exports = CustomEnvironment
