var searchIndex, $results, pagesIndex;

function initSearchIndex() {
  $.getJSON('/js/search/index.json')
  .done(function(documents) {
    pagesIndex = documents;
    searchIndex = lunr(function() {
      this.field('title');
      this.field('categories');
      this.field('content');
      this.ref('href');

      for (var i = 0; i < documents.length; ++i) {
        this.add(documents[i])
      }
    });
  })
  .fail(function(jqxhr, textStatus, error) {
    var err = textStatus + ', ' + error;
    console.error('Error getting index file:', err);
  });
}

function initUI() {
  $results = $('.posts');
  $('#search').keyup(function() {
    $results.empty();
    // only search when query has 2 characters or more
    var query = $(this).val();
    if (query.length < 2) {
      return;
    }
    var results = searchSite(query);
    renderResults(results);
  });
}

function searchSite(query_string) {
  return searchIndex.query(function(q) {
    // look for an exact match and give that a massive positive boost
    q.term(query_string, { usePipeline: true, boost: 100 });
    // prefix matches should not use stemming, and lower positive boost
    q.term(query_string, { usePipeline: false, boost: 10, wildcard: lunr.Query.wildcard.TRAILING });
  }).map(function(result) {
    return pagesIndex.filter(function(page) {
      return page.href === result.ref;
    })[0];
  });
}

function renderResults(results) {
  if (!results.length) {
    return;
  }

  results.slice(0, 10).forEach(function(hit) {
    var $result = $('<li>');
    $result.append($('<a>', {
      href: hit.href,
      text: '» ' + hit.title
    }));
    $result.append($('<p/>', { text: hit.content.slice(0, 100) + '...' }));
    $results.append($result);
  });
}

initSearchIndex();

$(document).ready(function() {
  initUI();
});
