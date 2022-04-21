import {
  createStakeEntryAndStakeMint,
  stake,
  unstake,
  claimRewards,
  executeTransaction,
} from '@cardinal/staking'
import { ReceiptType } from '@cardinal/staking/dist/cjs/programs/stakePool'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { TokenData } from 'api/types'
import { Header } from 'common/Header'
import Head from 'next/head'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'
import { useState } from 'react'
import { Wallet } from '@metaplex/js'
import { useUserTokenData } from 'providers/TokenDataProvider'
import { LoadingSpinner } from 'common/LoadingSpinner'
import { notify } from 'common/Notification'
import { pubKeyUrl, secondstoDuration } from 'common/utils'
import {
  formatMintNaturalAmountAsDecimal,
  getMintDecimalAmountFromNatural,
  getMintDecimalAmountFromNaturalV2,
  getMintNaturalAmountFromDecimal,
} from 'common/units'
import { BN } from '@project-serum/anchor'
import { useStakedTokenDatas } from 'hooks/useStakedTokenDatas'
import { useRewardDistributorData } from 'hooks/useRewardDistributorData'
import { useRewards } from 'hooks/useRewards'
import { useRewardMintInfo } from 'hooks/useRewardMintInfo'
import { AllowedTokens } from 'common/AllowedTokens'
import { useStakePoolEntries } from 'hooks/useStakePoolEntries'
import { useStakePoolData } from 'hooks/useStakePoolData'
import { useStakePoolMaxStaked } from 'hooks/useStakePoolMaxStaked'

function Home() {
  const { connection, environment } = useEnvironmentCtx()
  const wallet = useWallet()
  const { data: stakePool } = useStakePoolData()
  const stakedTokenDatas = useStakedTokenDatas()

  const {
    rewardDistributor,
    loadedRewardDistributorData,
    refreshRewardDistributorData,
    refreshingRewardDistributorData,
    rewardDistributorDataError,
  } = useRewardDistributorData(wallet.publicKey, stakePool)

  const { rewardMintInfo, rewardMintName } = useRewardMintInfo(
    wallet.publicKey,
    stakePool
  )

  const {
    rewardMap,
    claimableRewards,
    rewardsLoaded,
    refreshRewards,
    refreshingRewards,
  } = useRewards(wallet.publicKey, stakePool)

  const stakePoolEntries = useStakePoolEntries()
  const maxStaked = useStakePoolMaxStaked()

  const { refreshing, tokenDatas, loaded, refreshTokenAccounts } =
    useUserTokenData()
  const [unstakedSelected, setUnstakedSelected] = useState<TokenData[]>([])
  const [stakedSelected, setStakedSelected] = useState<TokenData[]>([])
  const [loadingStake, setLoadingStake] = useState(false)
  const [loadingUnstake, setLoadingUnstake] = useState(false)
  const [loadingClaimRewards, setLoadingClaimRewards] = useState(false)
  const [showFungibleTokens, setShowFungibleTokens] = useState(false)
  const [showAllowedTokens, setShowAllowedTokens] = useState<boolean>()

  const filteredTokens = tokenDatas.filter((token) => {
    if (
      (showFungibleTokens && !token.tokenListData) ||
      (!showFungibleTokens && token.tokenListData) ||
      !stakePool
    ) {
      return false
    }
    let isAllowed = true
    const creatorAddresses = stakePool.parsed.requiresCreators
    const collectionAddresses = stakePool.parsed.requiresCollections
    if (token.tokenAccount?.account.data.parsed.info.state === 'frozen') {
      return false
    }

    if (creatorAddresses && creatorAddresses.length > 0) {
      isAllowed = false
      creatorAddresses.forEach((filterCreator) => {
        if (
          token?.metaplexData?.data?.data?.creators &&
          (token?.metaplexData?.data?.data?.creators).some(
            (c) => c.address === filterCreator.toString() && c.verified
          )
        ) {
          isAllowed = true
        }
      })
    }

    if (collectionAddresses && collectionAddresses.length > 0 && !isAllowed) {
      collectionAddresses.forEach((collectionAddress) => {
        if (
          token.metaplexData?.data?.collection?.verified &&
          token.metaplexData?.data?.collection?.key.toString() ===
            collectionAddress.toString()
        ) {
          isAllowed = true
        }
      })
    }

    if (token.stakeAuthorization) {
      isAllowed = true
    }
    return isAllowed
  })

  async function handleClaimRewards() {
    if (stakedSelected.length > 4) {
      notify({ message: `Limit of 4 tokens at a time reached`, type: 'error' })
      return
    }
    setLoadingClaimRewards(true)
    if (!wallet) {
      throw new Error('Wallet not connected')
    }
    if (!stakePool) {
      throw new Error('No stake pool detected')
    }

    for (let step = 0; step < stakedSelected.length; step++) {
      try {
        let token = stakedSelected[step]
        if (!token || !token.stakeEntry) {
          throw new Error('No stake entry for token')
        }
        console.log('Claiming rewards...')

        const transaction = await claimRewards(connection, wallet as Wallet, {
          stakePoolId: stakePool.pubkey,
          originalMintId: token.stakeEntry.parsed.originalMint,
        })
        await executeTransaction(connection, wallet as Wallet, transaction, {})
        notify({ message: `Successfully claimed rewards`, type: 'success' })
        console.log('Successfully claimed rewards')
      } catch (e) {
        notify({ message: `Transaction failed: ${e}`, type: 'error' })
        console.error(e)
      } finally {
        break
      }
    }

    refreshRewards(true)
    setLoadingClaimRewards(false)
  }

  async function handleUnstake() {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }
    if (!stakePool) {
      throw new Error('No stake pool detected')
    }
    setLoadingUnstake(true)

    for (let step = 0; step < stakedSelected.length; step++) {
      try {
        let token = stakedSelected[step]
        if (!token || !token.stakeEntry) {
          throw new Error('No stake entry for token')
        }
        console.log('Unstaking...')
        // unstake
        const transaction = await unstake(connection, wallet as Wallet, {
          stakePoolId: stakePool?.pubkey,
          originalMintId: token.stakeEntry.parsed.originalMint,
        })
        await executeTransaction(connection, wallet as Wallet, transaction, {})
        notify({
          message: `Successfully unstaked ${step + 1}/${stakedSelected.length}`,
          type: 'success',
        })
        console.log('Successfully unstaked')
        await refreshTokenAccounts(true)
        await stakedTokenDatas.refresh(true)
      } catch (e) {
        notify({ message: `Transaction failed: ${e}`, type: 'error' })
        console.error(e)
        break
      }
    }

    refreshRewards(true)
    stakePoolEntries.refresh()
    setStakedSelected([])
    setUnstakedSelected([])
    setLoadingUnstake(false)
  }

  async function handleStake() {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }
    if (!stakePool) {
      throw new Error('No stake pool detected')
    }
    setLoadingStake(true)

    for (let step = 0; step < unstakedSelected.length; step++) {
      try {
        let token = unstakedSelected[step]
        if (!token || !token.tokenAccount) {
          throw new Error('Token account not set')
        }

        if (
          token.tokenAccount?.account.data.parsed.info.tokenAmount.amount > 1 &&
          !token.amountToStake
        ) {
          notify({ message: `Invalid amount chosen for token`, type: 'error' })
          return
        }

        if (token.stakeEntry && token.stakeEntry.parsed.amount.toNumber() > 0) {
          notify({
            message: `'Fungible tokens already staked in the pool. Staked tokens need to be unstaked and then restaked together with the new tokens.'`,
            type: 'error',
          })
          return
        }

        console.log('Creating stake entry and stake mint...')
        const [initTx, , stakeMintKeypair] = await createStakeEntryAndStakeMint(
          connection,
          wallet as Wallet,
          {
            stakePoolId: stakePool?.pubkey,
            originalMintId: new PublicKey(
              token.tokenAccount.account.data.parsed.info.mint
            ),
          }
        )
        if (initTx.instructions.length > 0) {
          await executeTransaction(connection, wallet as Wallet, initTx, {
            signers: stakeMintKeypair ? [stakeMintKeypair] : [],
          })
        }

        console.log('Successfully created stake entry and stake mint')
        console.log('Staking...')
        // stake
        const transaction = await stake(connection, wallet as Wallet, {
          stakePoolId: stakePool?.pubkey,
          receiptType: ReceiptType.Receipt,
          originalMintId: new PublicKey(
            token.tokenAccount.account.data.parsed.info.mint
          ),
          userOriginalMintTokenAccountId: token.tokenAccount?.pubkey,
          amount: token?.amountToStake
            ? new BN(
                token?.amountToStake && token.tokenListData
                  ? getMintNaturalAmountFromDecimal(
                      token?.amountToStake,
                      token.tokenListData?.decimals
                    )
                  : 1
              )
            : undefined,
        })
        await executeTransaction(connection, wallet as Wallet, transaction, {})
        notify({
          message: `Successfully staked ${step + 1}/${unstakedSelected.length}`,
          type: 'success',
        })
        console.log('Successfully staked')
        await refreshTokenAccounts(true)
        await stakedTokenDatas.refresh(true)
      } catch (e) {
        notify({ message: `Transaction failed: ${e}`, type: 'error' })
        console.error(e)
        break
      }
    }

    stakePoolEntries.refresh()
    refreshRewards(true)
    setStakedSelected([])
    setUnstakedSelected([])
    setLoadingStake(false)
  }

  const isUnstakedTokenSelected = (tk: TokenData) =>
    unstakedSelected.some(
      (utk) =>
        utk.tokenAccount?.account.data.parsed.info.mint.toString() ===
        tk.tokenAccount?.account.data.parsed.info.mint.toString()
    )
  const isStakedTokenSelected = (tk: TokenData) =>
    stakedSelected.some(
      (stk) =>
        stk.stakeEntry?.parsed.originalMint.toString() ===
        tk.stakeEntry?.parsed.originalMint.toString()
    )

  return (
    <>
      <div>
        <Head>
          <title>Cardinal Staking UI</title>
          <meta name="description" content="Generated by Cardinal Staking UI" />
          <link rel="icon" href="/favicon.ico" />
        </Head>

        <div>
          <div className="container mx-auto max-h-[90vh] w-full bg-[#1a1b20]">
            <Header />
            {rewardDistributor && rewardMintInfo && rewardsLoaded && (
              <div className="mx-5 mb-4 flex flex-col rounded-md bg-white bg-opacity-5 p-10 text-gray-200 md:max-h-[100px] md:flex-row md:justify-between">
                <p className="mb-3 mr-10 inline-block w-52 text-lg">
                  Total Staked: {stakePoolEntries.data?.length}
                </p>

                {maxStaked && (
                  <p className="mb-3 mr-10 inline-block w-52 text-lg">
                    {/*TODO: Change how many total NFTs can possibly be staked for your collection (default 10000) */}
                    Percent Staked:{' '}
                    {stakePoolEntries.data?.length
                      ? Math.floor(
                          ((stakePoolEntries.data?.length * 100) / maxStaked) *
                            10000
                        ) / 10000
                      : 0}
                    %
                  </p>
                )}
                {rewardMintInfo ? (
                  <>
                    <p className="mb-3 mr-10 inline-block text-lg ">
                      Rewards Rate:{' '}
                      {(
                        (Number(
                          getMintDecimalAmountFromNatural(
                            rewardMintInfo!,
                            new BN(rewardDistributor.parsed.rewardAmount)
                          )
                        ) /
                          rewardDistributor.parsed.rewardDurationSeconds.toNumber()) *
                        86400
                      ).toPrecision(3)}{' '}
                      <a
                        className="text-white underline"
                        target="_blank"
                        href={pubKeyUrl(
                          rewardDistributor.parsed.rewardMint,
                          environment.label
                        )}
                      >
                        {rewardMintName}
                      </a>{' '}
                      / Day
                    </p>
                    <div className="mb-3 mr-10 flex min-w-[200px] text-lg">
                      {!rewardMintInfo || !rewardsLoaded ? (
                        <div className="relative flex h-8 w-full items-center justify-center">
                          <span className="text-gray-500"></span>
                          <div className="absolute w-full animate-pulse items-center justify-center rounded-lg bg-white bg-opacity-10 p-5"></div>
                        </div>
                      ) : (
                        Object.values(rewardMap).length > 0 &&
                        `Earnings: ${formatMintNaturalAmountAsDecimal(
                          rewardMintInfo,
                          claimableRewards,
                          6
                        )}
                          ${rewardMintName}`
                      )}
                    </div>
                  </>
                ) : (
                  <div className="relative flex w-full items-center justify-center">
                    <span className="text-gray-500">
                      Loading Pool Rewards Info...
                    </span>
                    <div className="absolute w-full animate-pulse items-center justify-center rounded-lg bg-white bg-opacity-10 p-5"></div>
                  </div>
                )}
              </div>
            )}
            <div className="my-2 mx-5 grid h-full grid-cols-1 gap-4 md:grid-cols-2">
              <div className="h-[85vh] max-h-[85vh] flex-col rounded-md bg-white bg-opacity-5 p-10 text-gray-200">
                <div className="mt-2 flex w-full flex-row justify-between">
                  <div className="flex flex-row">
                    <p className="mb-3 mr-3 inline-block text-lg">
                      Select Your Tokens
                    </p>
                    <div className="inline-block">
                      {refreshing && loaded && <LoadingSpinner height="25px" />}
                    </div>
                  </div>

                  <div className="flex flex-row">
                    <button
                      onClick={() => setShowAllowedTokens(!showAllowedTokens)}
                      className="text-md mr-5 inline-block rounded-md bg-white bg-opacity-5 px-4 py-1 hover:bg-opacity-10 focus:outline-none"
                    >
                      {showAllowedTokens ? 'Hide' : 'Show'} Allowed Tokens
                    </button>
                    <button
                      onClick={() => {
                        setShowFungibleTokens(!showFungibleTokens)
                      }}
                      className="text-md inline-block rounded-md bg-white bg-opacity-5 px-4 py-1 hover:bg-opacity-10"
                    >
                      {showFungibleTokens ? 'Show NFTs' : 'Show FTs'}
                    </button>
                  </div>
                </div>
                {showAllowedTokens && (
                  <AllowedTokens stakePool={stakePool}></AllowedTokens>
                )}
                {wallet.connected && (
                  <div className="my-3 flex-auto overflow-auto">
                    <div className="relative my-auto mb-4 h-[60vh] overflow-y-auto overflow-x-hidden rounded-md bg-white bg-opacity-5 p-5">
                      {loaded && filteredTokens.length == 0 && (
                        <p className="text-gray-400">
                          No allowed tokens found in wallet.
                        </p>
                      )}
                      {loaded ? (
                        <div
                          className={
                            'grid grid-cols-2 gap-1 md:gap-4 lg:grid-cols-2 xl:grid-cols-3'
                          }
                        >
                          {filteredTokens.map((tk) => (
                            <div key={tk.tokenAccount?.pubkey.toString()}>
                              <div className="relative w-44 md:w-auto 2xl:w-48">
                                <label
                                  htmlFor={tk?.tokenAccount?.pubkey.toBase58()}
                                  className="relative"
                                >
                                  <div className="relative">
                                    <div>
                                      <div className="relative">
                                        {loadingStake &&
                                          isUnstakedTokenSelected(tk) && (
                                            <div>
                                              <div className="absolute top-0 left-0 z-10 flex h-full w-full justify-center rounded-xl bg-black bg-opacity-80  align-middle">
                                                <div className="my-auto flex">
                                                  <span className="mr-2">
                                                    <LoadingSpinner height="25px" />
                                                  </span>
                                                  Staking token...
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        <img
                                          className="mx-auto mt-4 mb-2 rounded-xl bg-white bg-opacity-5 object-contain md:h-40 md:w-40 2xl:h-48 2xl:w-48"
                                          src={
                                            tk.metadata?.data.image ||
                                            tk.tokenListData?.logoURI
                                          }
                                          alt={
                                            tk.metadata?.data.name ||
                                            tk.tokenListData?.name
                                          }
                                        />
                                      </div>

                                      {tk.tokenListData ? (
                                        <div className="mx-2 flex justify-start">
                                          {/* <div className="float-left mr-2 inline overflow-clip text-ellipsis whitespace-nowrap ">
                                        {tk.tokenListData.name}
                                      </div> */}

                                          <div className="float-left text-ellipsis whitespace-nowrap">
                                            {Number(
                                              (
                                                tk.tokenAccount?.account.data
                                                  .parsed.info.tokenAmount
                                                  .amount /
                                                10 ** tk.tokenListData.decimals
                                              ).toFixed(2)
                                            )}{' '}
                                            {tk.tokenListData.symbol}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="mx-2 overflow-clip text-ellipsis whitespace-nowrap capitalize text-white">
                                          {tk.metadata?.data?.name}
                                        </p>
                                      )}
                                    </div>

                                    <input
                                      placeholder={
                                        tk.tokenAccount?.account.data.parsed
                                          .info.tokenAmount.amount > 1
                                          ? '1'
                                          : ''
                                      }
                                      autoComplete="off"
                                      type={
                                        tk.tokenAccount?.account.data.parsed
                                          .info.tokenAmount.amount > 1
                                          ? 'text'
                                          : 'checkbox'
                                      }
                                      className={`absolute h-4 ${
                                        tk.tokenAccount?.account.data.parsed
                                          .info.tokenAmount.amount > 1
                                          ? `w-20 py-3 px-2 text-right`
                                          : 'w-4'
                                      } top-2 right-2 rounded-sm font-medium text-black focus:outline-none`}
                                      id={tk?.tokenAccount?.pubkey.toBase58()}
                                      name={tk?.tokenAccount?.pubkey.toBase58()}
                                      onChange={(e) => {
                                        const amount = Number(e.target.value)
                                        if (
                                          tk.tokenAccount?.account.data.parsed
                                            .info.tokenAmount.amount > 1
                                        ) {
                                          if (
                                            e.target.value.length > 0 &&
                                            !amount
                                          ) {
                                            notify({
                                              message:
                                                'Please enter a valid amount',
                                              type: 'error',
                                            })
                                            setUnstakedSelected(
                                              unstakedSelected.filter(
                                                (data) =>
                                                  data.tokenAccount?.account.data.parsed.info.mint.toString() !==
                                                  tk.tokenAccount?.account.data.parsed.info.mint.toString()
                                              )
                                            )
                                            return
                                          }
                                          tk.amountToStake = amount
                                        }

                                        if (isUnstakedTokenSelected(tk)) {
                                          setUnstakedSelected(
                                            unstakedSelected.filter(
                                              (data) =>
                                                data.tokenAccount?.account.data.parsed.info.mint.toString() !==
                                                tk.tokenAccount?.account.data.parsed.info.mint.toString()
                                            )
                                          )
                                        } else {
                                          if (
                                            tk.tokenAccount?.account.data.parsed
                                              .info.tokenAmount.amount > 1
                                          ) {
                                            tk.amountToStake = amount
                                          }
                                          setUnstakedSelected([
                                            ...unstakedSelected,
                                            tk,
                                          ])
                                        }
                                      }}
                                    />
                                  </div>
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                          <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                          <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                          <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2 flex flex-row-reverse">
                  <button
                    onClick={() => {
                      if (unstakedSelected.length === 0) {
                        notify({
                          message: `No tokens selected`,
                          type: 'error',
                        })
                      }
                      handleStake()
                    }}
                    className="my-auto flex rounded-md bg-blue-700 px-4 py-2 hover:bg-blue-800"
                  >
                    <span className="mr-1 inline-block">
                      {loadingStake && <LoadingSpinner height="25px" />}
                    </span>
                    <span className="my-auto">Stake Tokens</span>
                  </button>
                </div>
              </div>
              <div className="h-[85vh] max-h-[85vh] rounded-md bg-white bg-opacity-5 p-10 text-gray-200">
                <div className="mt-2 flex flex-row">
                  <p className="mr-3 text-lg">
                    View Staked Tokens{' '}
                    {stakedTokenDatas.loaded &&
                      stakedTokenDatas.data &&
                      `(${stakedTokenDatas.data.length})`}
                  </p>
                  <div className="inline-block">
                    {stakedTokenDatas.refreshing && stakedTokenDatas.loaded && (
                      <LoadingSpinner height="25px" />
                    )}
                  </div>
                </div>
                {wallet.connected && (
                  <div className="my-3 flex-auto overflow-auto">
                    <div className="relative my-auto mb-4 h-[60vh] overflow-y-auto overflow-x-hidden rounded-md bg-white bg-opacity-5 p-5">
                      {stakedTokenDatas.loaded &&
                        stakedTokenDatas.data?.length === 0 && (
                          <p className="text-gray-400">
                            No tokens currently staked.
                          </p>
                        )}
                      {stakedTokenDatas.loaded && stakedTokenDatas.data ? (
                        <div className="grid grid-cols-2 gap-1 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                          {stakedTokenDatas.data.map((tk) => (
                            <div
                              className="relative"
                              key={tk?.stakeEntry?.pubkey.toBase58()}
                            >
                              {(loadingUnstake || loadingClaimRewards) &&
                                isStakedTokenSelected(tk) && (
                                  <div>
                                    <div className="absolute top-0 left-0 z-10 flex h-full w-full justify-center rounded-lg bg-black bg-opacity-80  align-middle">
                                      <div className="mx-auto flex items-center justify-center">
                                        <span className="mr-2">
                                          <LoadingSpinner height="25px" />
                                        </span>
                                        {loadingUnstake
                                          ? 'Unstaking token...'
                                          : 'Claim rewards...'}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              <label
                                htmlFor={tk?.stakeEntry?.pubkey.toBase58()}
                                className="relative"
                              >
                                <div className="relative">
                                  <div>
                                    <img
                                      className="rounded-lg"
                                      src={
                                        tk.metadata?.data.image ||
                                        tk.tokenListData?.logoURI
                                      }
                                      alt={
                                        tk.metadata?.data.name ||
                                        tk.tokenListData?.name
                                      }
                                    />
                                    {tk.tokenListData ? (
                                      <div className="absolute bottom-2 left-2">
                                        {tk.tokenListData.name}
                                      </div>
                                    ) : (
                                      ''
                                    )}
                                    {tk.tokenListData && (
                                      <div className="absolute bottom-2 right-2">
                                        {Number(
                                          getMintDecimalAmountFromNaturalV2(
                                            tk.tokenListData!.decimals,
                                            new BN(
                                              tk.stakeEntry!.parsed.amount.toNumber()
                                            )
                                          ).toFixed(2)
                                        )}{' '}
                                        {tk.tokenListData.symbol}
                                      </div>
                                    )}
                                    {rewardMap &&
                                      rewardMap[
                                        tk.stakeEntry?.parsed.originalMint.toString() ||
                                          ''
                                      ] &&
                                      rewardDistributor?.parsed.rewardDurationSeconds.gt(
                                        new BN(60)
                                      ) && (
                                        <div className="mt-1 flex items-center justify-center text-xs">
                                          {secondstoDuration(
                                            rewardMap[
                                              tk.stakeEntry?.parsed.originalMint.toString() ||
                                                ''
                                            ]?.nextRewardsIn.toNumber() || 0
                                          )}{' '}
                                        </div>
                                      )}
                                  </div>

                                  <input
                                    placeholder={
                                      tk.stakeEntry!.parsed.amount.toNumber() >
                                      1
                                        ? Number(
                                            getMintDecimalAmountFromNaturalV2(
                                              tk.tokenListData!.decimals,
                                              new BN(
                                                tk.stakeEntry!.parsed.amount.toNumber()
                                              )
                                            ).toFixed(2)
                                          ).toString()
                                        : ''
                                    }
                                    autoComplete="off"
                                    type="checkbox"
                                    className={`absolute top-2 right-2 h-4 w-4 rounded-sm font-medium text-black focus:outline-none`}
                                    id={tk?.stakeEntry?.pubkey.toBase58()}
                                    name={tk?.stakeEntry?.pubkey.toBase58()}
                                    onChange={() => {
                                      if (isStakedTokenSelected(tk)) {
                                        setStakedSelected(
                                          stakedSelected.filter(
                                            (data) =>
                                              data.stakeEntry?.parsed.originalMint.toString() !==
                                              tk.stakeEntry?.parsed.originalMint.toString()
                                          )
                                        )
                                      } else {
                                        setStakedSelected([
                                          ...stakedSelected,
                                          tk,
                                        ])
                                      }
                                    }}
                                  />
                                </div>
                              </label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                          <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                          <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                          <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2 flex flex-row-reverse">
                  <button
                    onClick={() => {
                      if (stakedSelected.length === 0) {
                        notify({
                          message: `No tokens selected`,
                          type: 'error',
                        })
                      }
                      handleUnstake()
                    }}
                    className="my-auto flex rounded-md bg-blue-700 px-4 py-2"
                  >
                    <span className="mr-1 inline-block">
                      {loadingUnstake ? <LoadingSpinner height="25px" /> : ''}
                    </span>
                    <span className="my-auto">Unstake Tokens</span>
                  </button>
                  {rewardDistributor ? (
                    <button
                      onClick={() => {
                        if (stakedSelected.length === 0) {
                          notify({
                            message: `No tokens selected`,
                            type: 'error',
                          })
                        }
                        handleClaimRewards()
                      }}
                      disabled={!claimableRewards.gt(new BN(0))}
                      className={`my-auto mr-5 flex rounded-md bg-${
                        claimableRewards.gt(new BN(0)) ? 'blue-700' : 'gray-700'
                      } px-4 py-2`}
                    >
                      <span className="mr-1 inline-block">
                        {loadingClaimRewards && (
                          <LoadingSpinner height="20px" />
                        )}
                      </span>
                      <span className="my-auto">Claim Rewards</span>
                    </button>
                  ) : (
                    ''
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Home