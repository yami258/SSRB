(function () {
'use strict'

//----------
// Wiki拡張本体
//----------

class WikiExtension {

//----------
// 共通処理
//----------

constructor () {
    this.updateReadyState('initializing')
    if (document.readyState === 'loading') {
        document.addEventListener('readystatechange', () => {
            if (document.readyState === 'interactive') {
                this.init()
            }
       })
    } else {
        this.init()
    }
} // constructor

// 初期化
init () {
    if (this.readyState !== 'initializing') {
        throw new Error('already initialized')
    }

    this.initPageInfo()
    this.initCustomHashParams()
    this.updateReadyState('initialized')

    const shouldStopBeforeSetup = !!localStorage.getItem('stop_before_setup')
    if (shouldStopBeforeSetup) {
        console.log('setup stopped')
    } else {
        window.setTimeout(() => { this.setup() })
    }
} // init

// 各画面に魔改造を適用
setup () {
    if (this.readyState === 'initializing') {
        throw new Error('not yet initialized')
    }

    if (this.pageType === 'article') {
        this.setupTableFilter()
        this.setupScrollableTable()
        this.setupAutoFilter() // 歌唱楽曲一覧ページなど
        this.setupGoogleCalendarIframe()
        if (!this.isMobileLayout) {
        }

    } else if (this.pageType === 'edit') {
        // PC版のみ適用
        if (!this.isMobileLayout) {
        }
    }

    this.updateReadyState('loaded')
    console.log('extension has applied.')
} // setup

// 状態を更新
updateReadyState (name) {
    this.readyState = name
    const event = new Event('extension-readystatechange')
    event.wikiExtension = this
    event.readyState = this.readyState
    document.dispatchEvent(event)
}

// ページ情報を確認
initPageInfo () {
    let wikiId = null
    let restPath = ''

    if (location.hostname === 'seesaawiki.jp') {
        [wikiId, restPath] = location.pathname.split(/^\/(?:w\/)?([^/]+)/).slice(1)
    }

    // Wiki ID
    this.wikiId = wikiId
    // ページ種別
    this.pageType = getPageType(restPath)
    // スマホ向け
    this.isMobileLayout = !!document.head.querySelector("meta[name='format-detection']")

    function getPageType (restPath) {
        if (restPath.startsWith('/d/') || restPath === '/') {
            return 'article'
        } else if (restPath.startsWith('/e/')) {
            return 'edit'
        }
        return null
    }
} // initPageInfo

//----------
// URLパラメータとアンカージャンプ
//----------

initCustomHashParams () {

    // パラメータ収集
    const parseParams = (urlStr) => {
        const url = new URL(urlStr)
        const params = new MyURLSearchParams(url.search)
        let hash = url.hash

        const sep = hash.indexOf('?')
        if (sep > -1) {
            const search = hash.substring(sep)
            const hashParams = new MyURLSearchParams(search)
            hashParams.forEach((val, key) => {
                params.set(key, val)
            })
            hash = hash.substring(0, sep)
        }

        params.freeze()

        return [params, hash]
    }

    // 情報更新＆イベント発火
    const updateParams = (params, hash, trigger) => {
        this.urlParams = params
        this.urlHash = hash

        if (trigger) {
            const event = new Event('extension-paramchange')
            event.params = params
            event.hash = hash
            window.dispatchEvent(event)
        }
    }

    // アンカージャンプ
    const jumpToAnchor = (aname) => {
        const anchor = document.getElementById(aname) || Array.prototype.find.call(document.querySelectorAll('a[name]'), (el) => (el.name === aname))
        if (anchor) {
            // anchor.scrollIntoView();
            window.scrollTo(0, anchor.offsetTop - 40)
        }
    }

    // hashが変わった時に情報更新＆イベントを発火
    window.addEventListener('hashchange', (e) => {
        const [params, hash] = parseParams(e.newURL)
        updateParams(params, hash, true)
    })

    // hashが変わった時に本来のアンカージャンプを実行
    window.addEventListener('extension-paramchange', (e) => {
        if (e.hash.length > 1) {
            const aname = e.hash.substring(1)
            jumpToAnchor(aname)
        }
    })

    // ページ読み込み時に初回処理
    {
        const [params, hash] = parseParams(location.href)
        updateParams(params, hash, false)
    }

    // ページ読み込み時に初回ジャンプ
    document.addEventListener('DOMContentLoaded', () => {
        if (this.urlHash.length > 1 && this.urlHash !== location.hash) {
            const aname = this.urlHash.substring(1)
            jumpToAnchor(aname)
        }
    })

} // initCustomHashParams

//----------
// フィルター機能の改善 class="filter regex" (記事画面)
//----------

setupTableFilter () {

    // テーブルにイイカンジのフィルター機能を搭載
    $('table.filter').each(function (i) {
        const input = $('#table-filter-' + i)
        const table = $(this)

        // フィルター入力欄とテーブルを紐づけ
        input.data('target', table)

        // オリジナルの入力監視機能を無効化
        input.unbind('focus').blur().unbind('blur')

        // 自前の入力監視・フィルター適用機能で上書き
        input.textChange({
            change: function (self) {
                $(self).trigger('apply')
            }
        })
        input.change(function () {
            $(this).trigger('apply')
        })

    })

    // 正規表現・大小区別に応じたマッチング関数を生成するやつ
    const gen_tester = (pattern, ignore, regex) => {
        if (regex) {
            try {
                const re = new RegExp(pattern, (ignore ? 'i' : ''))
                return (t) => re.test(t)
            } catch (e) {
                return null
            }
        } else {
            if (ignore) {
                const sub = pattern.toLowerCase()
                return (t) => t.toLowerCase().includes(sub)
            } else {
                return (t) => t.includes(pattern)
            }
        }
    }

    // 正規表現対応のフィルター適用処理
    $("input[id^='table-filter-']").on('apply', function () {
        const pattern = $(this).val()
        const prev = $(this).data('prev')
        if (prev === pattern) return
        $(this).data('prev', pattern)

        const table = $(this).data('target')

        // 設定に応じたマッチング関数を用意
        const is_regex = table.hasClass('regex')
        const ignore_case = true // 一律で大小区別なし
        const test = gen_tester(pattern, ignore_case, is_regex)
        if (test === null) return

        // フィルター適用
        const rows = table.find('> tbody > tr')
        rows.each((i, row) => {
            $(row).toggle(test($(row).text()))
        })

        // ストライプ更新など
        table.trigger('change')
    })

} // setupTableFilter

//----------
// 縦横スクロールテーブル class="scrollX scrollY" (記事画面)
//----------

setupScrollableTable () {

    $('table[id*="content_block_"].scrollX').wrap('<div class="x-scroller">')
    $('table[id*="content_block_"].scrollY').wrap('<div class="y-scroller">')

} // setupScrollableTable

//----------
// 自動絞り込み
//----------

setupAutoFilter () {

    applyFilters.call(this)

    function applyFilters () {
        const title = document.title
        const keyword = this.urlParams.get('keyword')
        if (keyword) {
            const order = this.urlParams.get('order') || 0
            applyFilter(order, keyword)
        }
    }

    window.addEventListener('extension-paramchange', (e) => {
        const keyword = e.params.get('keyword')
        if (keyword) {
            const order = e.params.get('order') || 0
            applyFilter(order, keyword)
        }
    }, false)

    function applyFilter (indice, keyword) {
        for (const idx of String(indice).split(',')) {
            const table = $('table.filter').eq(idx)
            const input = $(`#table-filter-${idx}`)
            if (!input) return
            table.addClass('regex')
            input.val(keyword).change()
        }
    }

} // setupAutoFilter

//----------
// Googleカレンダー埋め込み
//----------

setupGoogleCalendarIframe () {
    const title = document.title
    const page_url = location.href

    if (title.includes('【スケジュール】') || page_url == 'https://seesaawiki.jp/ssrb/') {
        let content_block_element = document.getElementById('content_block_2-body')
        let new_element = document.createElement('iframe')
        new_element.style = 'border:solid 1px #777'
        new_element.width = '100%'
        new_element.height = '500'
        new_element.setAttribute('frameBorder', '0')
        new_element.setAttribute('scrolling', 'no')
        new_element.src = 'https://calendar.google.com/calendar/embed?height=600&wkst=1&bgcolor=%23A79B8E&ctz=Asia%2FTokyo&showTitle=0&showPrint=0&showTz=0&showCalendars=1&showNav=1&showDate=1&mode=AGENDA&src=cGM2ODAxc3JAZ21haWwuY29t&color=%237986CB'
        content_block_element.before(new_element)
    }
} // setupGoogleCalendarIframe

} // class WikiExtension

// URLSearchParams に対応していないブラウザ用
class MyURLSearchParams {

    constructor (search) {
        this.params = {}
        this._readOnly = false
        if (search == null) {
            return
        }
        if (search.startsWith('?')) {
            search = search.substring(1)
        }
        for (const param of search.split('&')) {
            const sep = param.indexOf('=')
            let key = param
            let value = ''
            if (sep >= 0) {
                key = param.substring(0, sep)
                value = param.substring(sep + 1)
            }
            if (key) {
                this.params[decodeURIComponent(key)] = decodeURIComponent(value)
            }
        }
    }

    get (key) {
        return this.params[key]
    }

    set (key, value) {
        if (this._readOnly) {
            throw new Error('read only param')
        }
        this.params[key] = value
    }

    delete (key) {
        if (this._readOnly) {
            throw new Error('read only param')
        }
        delete this.params[key]
    }

    forEach (fn) {
        for (const key in this.params) {
            fn(this.params[key], key)
        }
    }

    toString () {
        const keys = Object.keys(this.params)
        if (keys.length === 0) {
            return ''
        }
        return '?' + keys.map((k) => {
            return encodeURIComponent(k) + '=' + encodeURIComponent(this.params[k])
        }).join('&')
    }

    freeze () {
        this._readOnly = true
    }

} // class MyURLSearchParams

// Wiki拡張を適用
window.wikiExtension = new WikiExtension()

})()
