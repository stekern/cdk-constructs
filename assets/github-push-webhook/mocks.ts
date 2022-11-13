import { ForwardingRule, DbPushEvent } from "./types"

export const pushEvent: DbPushEvent = {
  PK: "pk",
  SK: "sk",
  schemaVersion: "0.1",
  branch: "dev",
  isDefaultBranch: true,
  payload: {
    ref: "refs/heads/dev",
    before: "83054c3ad04a03ed653f63e9ff2adb47c02c097d",
    after: "5b48e53fe13c778e6fe081097dff053215a42045",
    repository: {
      id: 23456789,
      node_id: "A_bcdefgh",
      name: "my-repo",
      full_name: "ghuser/my-repo",
      private: false,
      owner: {
        name: "ghuser",
        email: "ghuser@users.noreply.github.com",
        login: "ghuser",
        id: 12345678,
        node_id: "B_cdefghi",
        avatar_url: "https://avatars.githubusercontent.com/u/12345678?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ghuser",
        html_url: "https://github.com/ghuser",
        followers_url: "https://api.github.com/users/ghuser/followers",
        following_url:
          "https://api.github.com/users/ghuser/following{/other_user}",
        gists_url: "https://api.github.com/users/ghuser/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ghuser/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ghuser/subscriptions",
        organizations_url: "https://api.github.com/users/ghuser/orgs",
        repos_url: "https://api.github.com/users/ghuser/repos",
        events_url: "https://api.github.com/users/ghuser/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ghuser/received_events",
        type: "User",
        site_admin: false,
      },
      html_url: "https://github.com/ghuser/my-repo",
      description: "Experimental AWS CDK construct library",
      fork: false,
      url: "https://github.com/ghuser/my-repo",
      forks_url: "https://api.github.com/repos/ghuser/my-repo/forks",
      keys_url: "https://api.github.com/repos/ghuser/my-repo/keys{/key_id}",
      collaborators_url:
        "https://api.github.com/repos/ghuser/my-repo/collaborators{/collaborator}",
      teams_url: "https://api.github.com/repos/ghuser/my-repo/teams",
      hooks_url: "https://api.github.com/repos/ghuser/my-repo/hooks",
      issue_events_url:
        "https://api.github.com/repos/ghuser/my-repo/issues/events{/number}",
      events_url: "https://api.github.com/repos/ghuser/my-repo/events",
      assignees_url:
        "https://api.github.com/repos/ghuser/my-repo/assignees{/user}",
      branches_url:
        "https://api.github.com/repos/ghuser/my-repo/branches{/branch}",
      tags_url: "https://api.github.com/repos/ghuser/my-repo/tags",
      blobs_url: "https://api.github.com/repos/ghuser/my-repo/git/blobs{/sha}",
      git_tags_url:
        "https://api.github.com/repos/ghuser/my-repo/git/tags{/sha}",
      git_refs_url:
        "https://api.github.com/repos/ghuser/my-repo/git/refs{/sha}",
      trees_url: "https://api.github.com/repos/ghuser/my-repo/git/trees{/sha}",
      statuses_url:
        "https://api.github.com/repos/ghuser/my-repo/statuses/{sha}",
      languages_url: "https://api.github.com/repos/ghuser/my-repo/languages",
      stargazers_url: "https://api.github.com/repos/ghuser/my-repo/stargazers",
      contributors_url:
        "https://api.github.com/repos/ghuser/my-repo/contributors",
      subscribers_url:
        "https://api.github.com/repos/ghuser/my-repo/subscribers",
      subscription_url:
        "https://api.github.com/repos/ghuser/my-repo/subscription",
      commits_url: "https://api.github.com/repos/ghuser/my-repo/commits{/sha}",
      git_commits_url:
        "https://api.github.com/repos/ghuser/my-repo/git/commits{/sha}",
      comments_url:
        "https://api.github.com/repos/ghuser/my-repo/comments{/number}",
      issue_comment_url:
        "https://api.github.com/repos/ghuser/my-repo/issues/comments{/number}",
      contents_url:
        "https://api.github.com/repos/ghuser/my-repo/contents/{+path}",
      compare_url:
        "https://api.github.com/repos/ghuser/my-repo/compare/{base}...{head}",
      merges_url: "https://api.github.com/repos/ghuser/my-repo/merges",
      archive_url:
        "https://api.github.com/repos/ghuser/my-repo/{archive_format}{/ref}",
      downloads_url: "https://api.github.com/repos/ghuser/my-repo/downloads",
      issues_url: "https://api.github.com/repos/ghuser/my-repo/issues{/number}",
      pulls_url: "https://api.github.com/repos/ghuser/my-repo/pulls{/number}",
      milestones_url:
        "https://api.github.com/repos/ghuser/my-repo/milestones{/number}",
      notifications_url:
        "https://api.github.com/repos/ghuser/my-repo/notifications{?since,all,participating}",
      labels_url: "https://api.github.com/repos/ghuser/my-repo/labels{/name}",
      releases_url: "https://api.github.com/repos/ghuser/my-repo/releases{/id}",
      deployments_url:
        "https://api.github.com/repos/ghuser/my-repo/deployments",
      created_at: 1661001460,
      updated_at: "2022-08-22T20:21:45Z",
      pushed_at: 1668277802,
      git_url: "git://github.com/ghuser/my-repo.git",
      ssh_url: "git@github.com:ghuser/my-repo.git",
      clone_url: "https://github.com/ghuser/my-repo.git",
      svn_url: "https://github.com/ghuser/my-repo",
      homepage: "",
      size: 159,
      stargazers_count: 0,
      watchers_count: 0,
      language: "TypeScript",
      has_issues: true,
      has_projects: true,
      has_downloads: true,
      has_wiki: true,
      has_pages: false,
      forks_count: 0,
      mirror_url: null,
      archived: false,
      disabled: false,
      open_issues_count: 1,
      license: null,
      allow_forking: true,
      is_template: false,
      web_commit_signoff_required: false,
      topics: ["aws", "cdk"],
      visibility: "public",
      forks: 0,
      open_issues: 1,
      watchers: 0,
      default_branch: "dev",
      stargazers: 0,
      master_branch: "dev",
    },
    pusher: {
      name: "ghuser",
      email: "ghuser@users.noreply.github.com",
    },
    sender: {
      login: "ghuser",
      id: 12345678,
      node_id: "B_cdefghi",
      avatar_url: "https://avatars.githubusercontent.com/u/12345678?v=4",
      gravatar_id: "",
      url: "https://api.github.com/users/ghuser",
      html_url: "https://github.com/ghuser",
      followers_url: "https://api.github.com/users/ghuser/followers",
      following_url:
        "https://api.github.com/users/ghuser/following{/other_user}",
      gists_url: "https://api.github.com/users/ghuser/gists{/gist_id}",
      starred_url: "https://api.github.com/users/ghuser/starred{/owner}{/repo}",
      subscriptions_url: "https://api.github.com/users/ghuser/subscriptions",
      organizations_url: "https://api.github.com/users/ghuser/orgs",
      repos_url: "https://api.github.com/users/ghuser/repos",
      events_url: "https://api.github.com/users/ghuser/events{/privacy}",
      received_events_url:
        "https://api.github.com/users/ghuser/received_events",
      type: "User",
      site_admin: false,
    },
    installation: {
      id: 34567890,
      node_id: "C_defghij",
    },
    created: false,
    deleted: false,
    forced: false,
    base_ref: null,
    compare:
      "https://github.com/ghuser/my-repo/compare/83054c3ad04a...5b48e53fe13c",
    commits: [
      {
        id: "5b48e53fe13c778e6fe081097dff053215a42045",
        tree_id: "914f3a17f6c1c2fbcef2671fb80fb4e14c4c029b",
        distinct: true,
        message: "fix: potential fix for bsd-specific behavior for cp utility",
        timestamp: "2022-11-12T19:29:58+01:00",
        url: "https://github.com/ghuser/my-repo/commit/5b48e53fe13c778e6fe081097dff053215a42045",
        author: {
          name: "ghuser",
          email: "ghuser@users.noreply.github.com",
          username: "ghuser",
        },
        committer: {
          name: "ghuser",
          email: "ghuser@users.noreply.github.com",
          username: "ghuser",
        },
        added: [],
        removed: [],
        modified: ["package.json"],
      },
    ],
    head_commit: {
      id: "5b48e53fe13c778e6fe081097dff053215a42045",
      tree_id: "914f3a17f6c1c2fbcef2671fb80fb4e14c4c029b",
      distinct: true,
      message: "fix: potential fix for bsd-specific behavior for cp utility",
      timestamp: "2022-11-12T19:29:58+01:00",
      url: "https://github.com/ghuser/my-repo/commit/5b48e53fe13c778e6fe081097dff053215a42045",
      author: {
        name: "ghuser",
        email: "ghuser@users.noreply.github.com",
        username: "ghuser",
      },
      committer: {
        name: "ghuser",
        email: "ghuser@users.noreply.github.com",
        username: "ghuser",
      },
      added: [],
      removed: [],
      modified: ["package.json"],
    },
  },
}
export const rule: ForwardingRule = {
  owner: "ghuser",
  repo: "my-repo",
  channel: "#my-channel",
}
